import {
  TICK_BATCH_VERSION,
  quoteSnapshotKey,
  tickStreamKey,
  type Quote,
} from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  followTickStreams,
  type TickStreamClient,
  type TickStreamRecord,
} from './tickStreamFollower.js';

const quote = (token: number, ltp: number): Quote => ({
  token,
  symbol: `S${token}`,
  exchange: 'NSE',
  ltp,
  change: ltp - 10_000,
  changeBp: Math.round(((ltp - 10_000) / 10_000) * 10_000),
  open: 10_000,
  high: Math.max(10_000, ltp),
  low: Math.min(10_000, ltp),
  prevClose: 10_000,
  volume: 100,
  ts: '2026-09-28T04:30:00.000Z',
});

const record = (id: string, seq: number, quotes: Quote[]): TickStreamRecord => [
  id,
  ['batch', JSON.stringify({ v: TICK_BATCH_VERSION, shard: 0, seq, quotes })],
];

/**
 * An in-memory stand-in for Redis: one stream and one snapshot. Each `xread` hands out the next
 * queued read, waiting for one (or for the close) when none is queued.
 */
function fakeRedis(init: { last?: TickStreamRecord; snapshot?: Quote[] }) {
  const reads: (unknown | Error)[] = [];
  const xreadArgs: (string | number)[][] = [];
  let closed = false;
  let wake: () => void = () => undefined;
  const push = (item: unknown) => {
    reads.push(item);
    wake();
  };
  let snapshot = init.snapshot ?? [];
  const client: TickStreamClient = {
    xrevrange: async () => (init.last ? [init.last] : []),
    hvals: async () => snapshot.map((q) => JSON.stringify(q)),
    xread: async (...args) => {
      xreadArgs.push(args);
      while (reads.length === 0 && !closed) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      const next = reads.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    },
    disconnect: () => {
      closed = true;
      wake();
    },
  };
  return {
    client,
    xreadArgs,
    queue: (...entries: TickStreamRecord[]) => push([[tickStreamKey(0), entries]]),
    fail: (error: Error) => push(error),
    setSnapshot: (quotes: Quote[]) => {
      snapshot = quotes;
    },
  };
}

describe('followTickStreams', () => {
  it('starts from the snapshot, then applies batches that follow in seq order', async () => {
    const redis = fakeRedis({
      last: record('5-0', 7, [quote(1, 10_100)]),
      snapshot: [quote(1, 10_100)],
    });
    const seen: number[][] = [];
    const follower = followTickStreams({
      client: redis.client,
      shards: 1,
      onQuotes: (quotes) => seen.push(quotes.map((q) => q.ltp)),
    });
    redis.queue(record('6-0', 8, [quote(1, 10_200)]), record('7-0', 9, [quote(1, 10_300)]));
    await follower.ready();
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    await follower.close();

    expect(seen).toEqual([[10_100], [10_200], [10_300]]);
    // It reads from the newest id it saw at start, so nothing in between is lost.
    expect(redis.xreadArgs[0]).toEqual([
      'COUNT',
      100,
      'BLOCK',
      5_000,
      'STREAMS',
      tickStreamKey(0),
      '5-0',
    ]);
    expect(redis.xreadArgs[1]?.at(-1)).toBe('7-0');
  });

  it('re-reads the snapshot on a seq gap or a restarted writer', async () => {
    const redis = fakeRedis({
      last: record('5-0', 7, [quote(1, 10_100)]),
      snapshot: [quote(1, 10_100)],
    });
    const seen: number[][] = [];
    const follower = followTickStreams({
      client: redis.client,
      shards: 1,
      onQuotes: (quotes) => seen.push(quotes.map((q) => q.ltp)),
    });
    await follower.ready();
    redis.setSnapshot([quote(1, 10_500), quote(2, 20_000)]);
    redis.queue(record('9-0', 12, [quote(1, 10_600)]), record('10-0', 1, [quote(1, 10_700)]));
    await vi.waitFor(() => expect(seen).toHaveLength(5));
    await follower.close();

    expect(seen).toEqual([[10_100], [10_500, 20_000], [10_600], [10_500, 20_000], [10_700]]);
  });

  it('drops malformed entries and snapshot rows, and keeps reading after a failed read', async () => {
    const redis = fakeRedis({});
    const warnings: string[] = [];
    const seen: number[][] = [];
    const follower = followTickStreams({
      client: { ...redis.client, hvals: async () => ['not json', JSON.stringify({ ltp: 1 })] },
      shards: 1,
      blockMs: 50,
      onQuotes: (quotes) => seen.push(quotes.map((q) => q.ltp)),
      log: { warn: (message) => warnings.push(message) },
    });
    await follower.ready();
    redis.fail(new Error('connection reset'));
    redis.queue(['1-0', ['batch', '{']], ['2-0', ['other', 'x']]);
    // The failed read waits half a second before the next one.
    await vi.waitFor(() => expect(warnings).toHaveLength(4), { timeout: 2_000 });
    await follower.close();

    expect(seen).toEqual([]);
    expect(warnings).toEqual([
      'Dropped unparseable snapshot rows',
      'Reading the tick stream failed',
      'Dropped a malformed tick stream entry',
      'Dropped a malformed tick stream entry',
    ]);
    expect(redis.xreadArgs[0]?.at(-1)).toBe('0-0');
  });

  it('reads every shard with its own keys', async () => {
    const redis = fakeRedis({});
    const keys: string[] = [];
    const follower = followTickStreams({
      client: {
        ...redis.client,
        xrevrange: async (key) => {
          keys.push(key);
          return [];
        },
        hvals: async (key) => {
          keys.push(key);
          return [];
        },
      },
      shards: 2,
      streamKey: (shard) => `t:${shard}`,
      snapshotKey: (shard) => `s:${shard}`,
      onQuotes: () => undefined,
    });
    await follower.ready();
    await follower.close();

    expect(keys).toEqual(['t:0', 's:0', 't:1', 's:1']);
  });

  it('defaults to the contract key names', async () => {
    const redis = fakeRedis({});
    const keys: string[] = [];
    const follower = followTickStreams({
      client: {
        ...redis.client,
        xrevrange: async (key) => {
          keys.push(key);
          return [];
        },
        hvals: async (key) => {
          keys.push(key);
          return [];
        },
      },
      shards: 1,
      onQuotes: () => undefined,
    });
    await follower.ready();
    await follower.close();

    expect(keys).toEqual([tickStreamKey(0), quoteSnapshotKey(0)]);
  });

  it('keeps following when onQuotes throws, and resyncs on the next entry', async () => {
    const redis = fakeRedis({
      last: record('5-0', 7, [quote(1, 10_100)]),
      snapshot: [quote(1, 10_100)],
    });
    const seen: number[][] = [];
    const warnings: string[] = [];
    let failNext = false;
    const follower = followTickStreams({
      client: redis.client,
      shards: 1,
      onQuotes: (quotes) => {
        if (failNext) {
          failNext = false;
          throw new Error('listener broke');
        }
        seen.push(quotes.map((q) => q.ltp));
      },
      log: { warn: (message) => warnings.push(message) },
    });
    await follower.ready();
    failNext = true;
    redis.queue(record('6-0', 8, [quote(1, 10_200)]));
    await vi.waitFor(() => expect(warnings).toHaveLength(1));
    redis.setSnapshot([quote(1, 10_900)]);
    redis.queue(record('7-0', 9, [quote(1, 11_000)]));
    await vi.waitFor(() => expect(seen).toHaveLength(3), { timeout: 3_000 });
    await follower.close();

    expect(warnings).toEqual(['Reading the tick stream failed']);
    expect(seen).toEqual([[10_100], [10_900], [11_000]]);
  });

  it('retries a failed start until Redis answers, and logs the outage once', async () => {
    const redis = fakeRedis({ snapshot: [quote(1, 10_100)] });
    const warnings: string[] = [];
    const seen: number[][] = [];
    let attempts = 0;
    const follower = followTickStreams({
      client: {
        ...redis.client,
        xrevrange: async (...args) => {
          attempts += 1;
          if (attempts < 3) throw new Error('connection refused');
          return redis.client.xrevrange(...args);
        },
      },
      shards: 1,
      onQuotes: (quotes) => seen.push(quotes.map((q) => q.ltp)),
      log: { warn: (message) => warnings.push(message) },
    });
    await follower.ready();
    await follower.close();

    expect(attempts).toBe(3);
    expect(warnings).toEqual(['Starting the tick streams failed']);
    expect(seen).toEqual([[10_100]]);
  });

  it('resolves ready() and stops retrying when closed while Redis is down', async () => {
    const redis = fakeRedis({});
    const follower = followTickStreams({
      client: {
        ...redis.client,
        xrevrange: async () => {
          throw new Error('connection refused');
        },
      },
      shards: 1,
      onQuotes: () => undefined,
    });
    await follower.close();
    await follower.ready();
  });
});
