import { EventEmitter } from 'node:events';
import type { MatcherFill } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  logFillClientEvents,
  startMatcherFills,
  streamsOf,
  type FillStreamClient,
} from './matcherFills.js';

// matcherFills.integration.test.ts runs the reader on a real Redis; this covers its failure
// paths on a scripted stand-in.

const fill = (userId: string, ltp: number): MatcherFill => ({
  v: 1,
  userId,
  token: 1,
  ltp,
  ts: '2026-09-28T04:30:00.000Z',
  orderIds: ['o1'],
  stopIds: [],
});
const entry = (id: string, value: MatcherFill) => [id, ['fill', JSON.stringify(value)]];

type Script = {
  groupError?: string;
  /** `XAUTOCLAIM` replies, in order; then an empty page. */
  claims?: unknown[];
  /** The `XPENDING` reply; an Error is thrown as a failed call. */
  pending?: (args: (string | number)[]) => unknown;
  /** An `XACK` of this id fails. */
  ackFails?: (id: string | number | undefined) => boolean;
  /** Past the scripted reads, each read answers nothing at once instead of waiting. */
  readsAnswer?: boolean;
};

/** Answers each command from a script; an XREADGROUP with nothing scripted waits until closed. */
function scripted(reads: unknown[], options: Script = {}) {
  const calls: (string | number)[][] = [];
  let release: () => void = () => undefined;
  const client: FillStreamClient = {
    call: (command, ...args) => {
      calls.push([command, ...args]);
      if (command === 'XGROUP' && options.groupError) {
        return Promise.reject(new Error(options.groupError));
      }
      if (command === 'XREADGROUP') {
        if (reads.length > 0) {
          const next = reads.shift();
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        }
        if (options.readsAnswer) {
          return new Promise((resolve) => setImmediate(() => resolve(null)));
        }
        return new Promise((resolve) => {
          release = () => resolve(null);
        });
      }
      if (command === 'XAUTOCLAIM') {
        return Promise.resolve(options.claims?.shift() ?? ['0-0', [], []]);
      }
      if (command === 'XPENDING') {
        const reply = options.pending?.(args) ?? [];
        return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
      }
      if (command === 'XACK' && options.ackFails?.(args.at(-1))) {
        return Promise.reject(new Error('READONLY replica'));
      }
      return Promise.resolve(1);
    },
    disconnect: () => {
      calls.push(['disconnect']);
      release();
    },
  };
  const acks = () => calls.filter(([command]) => command === 'XACK').map((call) => call.at(-1));
  const of = (name: string) => calls.filter(([command]) => command === name);
  return { client, calls, acks, of };
}

const lines = () => {
  const logged: string[] = [];
  return {
    logged,
    log: { info: (m: string) => logged.push(m), warn: (m: string) => logged.push(m) },
  };
};

describe('streamsOf', () => {
  it('reads RESP2 pairs and a RESP3 map alike', () => {
    const records = [['1-0', ['fill', '{}']]];
    expect(streamsOf([['k', records]])).toEqual([['k', records]]);
    expect(streamsOf(['k', records, 'j', []])).toEqual([
      ['k', records],
      ['j', []],
    ]);
    expect(streamsOf(null)).toEqual([]);
  });
});

describe('startMatcherFills (NSTOCK-0367)', () => {
  it("runs each user's requests in order, and leaves a failed one and its successors pending", async () => {
    const { client, acks } = scripted([
      [
        [
          'k0',
          [
            entry('1-0', fill('u1', 100)),
            entry('2-0', fill('u2', 100)),
            entry('3-0', fill('u1', 99)),
          ],
        ],
      ],
    ]);
    const seen: string[] = [];
    const warnings: string[] = [];
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: async (request) => {
          seen.push(`${request.userId}@${String(request.ltp)}`);
          if (request.userId === 'u1') throw new Error('database down');
        },
      },
      client,
      shards: 1,
      consumer: 'c1',
      log: { info: () => undefined, warn: (m) => warnings.push(m) },
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await vi.waitFor(() => expect(acks()).toEqual(['2-0']));
    // u1's second request waits behind its failed first one.
    expect(seen.sort()).toEqual(['u1@100', 'u2@100']);
    expect(warnings).toEqual([
      'Matcher fill 1-0 on k0 for u1 failed (delivery 1 of 5): database down',
    ]);
    await reader.close();
  });

  it('keeps a group that already exists, and retries a failed read', async () => {
    const { client, calls } = scripted([new Error('connection reset'), null], {
      groupError: 'BUSYGROUP Consumer Group name already exists',
    });
    const lines: string[] = [];
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 2,
      consumer: 'c1',
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
      blockMs: 10,
    });
    await reader.ready();
    await vi.waitFor(
      () => expect(calls.filter(([c]) => c === 'XREADGROUP').length).toBeGreaterThanOrEqual(3),
      { timeout: 5_000 },
    );
    expect(lines).toEqual([
      'Reading matcher fills failed: connection reset',
      'Reading matcher fills again',
    ]);
    expect(calls.filter(([c]) => c === 'XGROUP')).toHaveLength(2);
    await reader.close();
  });

  it('creates the groups again when a read answers NOGROUP', async () => {
    const { client, calls, acks } = scripted([
      new Error('NOGROUP No such key or consumer group'),
      [['k0', [entry('1-0', fill('u1', 100))]]],
    ]);
    const lines: string[] = [];
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 1,
      consumer: 'c1',
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
      fillsKey: (shard) => `k${String(shard)}`,
      blockMs: 10,
    });
    await vi.waitFor(() => expect(acks()).toEqual(['1-0']), { timeout: 5_000 });
    expect(calls.filter(([c]) => c === 'XGROUP')).toHaveLength(2);
    expect(lines[0]).toContain('NOGROUP');
    await reader.close();
  });

  it('stops at once when another group error comes back', async () => {
    const { client } = scripted([], { groupError: 'NOPERM no permissions' });
    const lines: string[] = [];
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 1,
      consumer: 'c1',
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
    });
    await vi.waitFor(() =>
      expect(lines).toEqual(['Reading matcher fills failed: NOPERM no permissions']),
    );
    await reader.close();
    await reader.ready();
  });

  it('waits for a fill in flight when it closes', async () => {
    const { client } = scripted([[['k0', [entry('1-0', fill('u1', 100))]]]]);
    let finish: () => void = () => undefined;
    let committed = false;
    let started = false;
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: () => {
          started = true;
          return new Promise<void>((resolve) => {
            finish = () => {
              committed = true;
              resolve();
            };
          });
        },
      },
      client,
      shards: 1,
      consumer: 'c1',
      log: { info: () => undefined, warn: () => undefined },
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await vi.waitFor(() => expect(started).toBe(true));
    let closed = false;
    const closing = reader.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    finish();
    await closing;
    expect(committed).toBe(true);
  });
});

describe('startMatcherFills claims (NSTOCK-0388)', () => {
  it('follows the XAUTOCLAIM cursor to 0-0, skipping trimmed entries', async () => {
    const { client, of, acks } = scripted([], {
      claims: [
        ['5-0', [entry('1-0', fill('u1', 100)), null], []],
        ['0-0', [entry('6-0', fill('u2', 100))], ['4-0']],
      ],
    });
    const { log } = lines();
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 1,
      consumer: 'c1',
      log,
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await reader.ready();
    await vi.waitFor(() => expect(acks()).toEqual(['1-0', '6-0']));
    expect(of('XAUTOCLAIM').map((call) => call[5])).toEqual(['0-0', '5-0']);
    await reader.close();
  });

  it('claims again only once claimIdleMs has passed on its clock', async () => {
    let now = 1_000_000;
    // Every read answers at once, so the loop keeps coming back to its claim step.
    const { client, of } = scripted([], { readsAnswer: true });
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 2,
      consumer: 'c1',
      log: lines().log,
      claimIdleMs: 30_000,
      now: () => now,
    });
    const reads = () => of('XREADGROUP').length;
    await vi.waitFor(() => expect(reads()).toBeGreaterThan(10));
    // One round, one page per stream, however many reads went by.
    expect(of('XAUTOCLAIM')).toHaveLength(2);
    now += 29_999;
    const before = reads();
    await vi.waitFor(() => expect(reads()).toBeGreaterThan(before + 10));
    expect(of('XAUTOCLAIM')).toHaveLength(2);
    now += 1;
    await vi.waitFor(() => expect(of('XAUTOCLAIM')).toHaveLength(4));
    await reader.close();
  });

  it('dead-letters an entry delivered more than maxDeliveries times, and runs the others', async () => {
    const { client, of, acks } = scripted([], {
      claims: [['0-0', [entry('1-0', fill('u1', 100)), entry('2-0', fill('u2', 100))], []]],
      pending: () => [
        ['1-0', 'c1', 0, 4],
        ['2-0', 'c1', 0, 3],
      ],
    });
    const seen: string[] = [];
    const { logged, log } = lines();
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: async (request) => {
          seen.push(request.userId);
        },
      },
      client,
      shards: 1,
      consumer: 'c1',
      log,
      maxDeliveries: 3,
      fillsKey: (shard) => `k${String(shard)}`,
      deadLetterKey: 'dead',
    });
    await vi.waitFor(() => expect(acks().sort()).toEqual(['1-0', '2-0']));
    expect(seen).toEqual(['u2']);
    expect(of('XPENDING')[0]).toEqual(['XPENDING', 'k0', 'api', '1-0', '2-0', 102, 'c1']);
    const [dead] = of('XADD');
    expect(dead?.slice(0, 13)).toEqual([
      'XADD',
      'dead',
      'MAXLEN',
      '~',
      10_000,
      '*',
      'source',
      'k0',
      'id',
      '1-0',
      'reason',
      'delivered 3 times',
      'fill',
    ]);
    expect(logged).toEqual([
      'Dead-lettered matcher fill 1-0 on k0 for u1 after 3 deliveries (orders o1, stops -)',
    ]);
    await reader.close();
  });
});

describe('startMatcherFills entries (NSTOCK-0388)', () => {
  it('runs claimed fills as first deliveries when XPENDING fails', async () => {
    const { client, acks, of } = scripted([], {
      claims: [['0-0', [entry('1-0', fill('u1', 100))], []]],
      pending: () => new Error('LOADING Redis is loading the dataset in memory'),
    });
    const seen: string[] = [];
    const { logged, log } = lines();
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: async (request) => {
          seen.push(request.userId);
        },
      },
      client,
      shards: 1,
      consumer: 'c1',
      log,
      maxDeliveries: 1,
      fillsKey: (shard) => `k${String(shard)}`,
      deadLetterKey: 'dead',
    });
    await vi.waitFor(() => expect(acks()).toEqual(['1-0']));
    expect(seen).toEqual(['u1']);
    expect(of('XADD')).toEqual([]);
    expect(logged).toEqual([
      'Could not read delivery counts on k0, running the claimed fills: LOADING Redis is loading the dataset in memory',
    ]);
    await reader.close();
  });

  it('dead-letters a malformed entry with its id, user and the Zod issues', async () => {
    const { client, of, acks } = scripted([
      [
        [
          'k0',
          [
            ['1-0', ['fill', JSON.stringify({ ...fill('u1', 100), ltp: -5 })]],
            ['2-0', ['fill', '{not json']],
            ['3-0', ['other', 'x']],
          ],
        ],
      ],
    ]);
    const { logged, log } = lines();
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 1,
      consumer: 'c1',
      log,
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await vi.waitFor(() => expect(acks()).toEqual(['1-0', '2-0', '3-0']));
    expect(logged).toEqual([
      'Dead-lettered malformed matcher fill 1-0 on k0 (user u1): ltp: Too small: expected number to be >0',
      'Dead-lettered malformed matcher fill 2-0 on k0 (user unknown): not JSON',
      'Dead-lettered malformed matcher fill 3-0 on k0 (user unknown): no fill field',
    ]);
    expect(of('XADD').map((call) => [call[1], call[9], call[11]])).toEqual([
      [
        'nthstock:matcher:fills:dead:v1',
        '1-0',
        'malformed: ltp: Too small: expected number to be >0',
      ],
      ['nthstock:matcher:fills:dead:v1', '2-0', 'malformed: not JSON'],
      ['nthstock:matcher:fills:dead:v1', '3-0', 'malformed: no fill field'],
    ]);
    await reader.close();
  });

  it("logs a failed XACK and goes on with the user's next request and the batch", async () => {
    const { client, acks } = scripted(
      [
        [
          [
            'k0',
            [
              entry('1-0', fill('u1', 100)),
              entry('2-0', fill('u1', 99)),
              entry('3-0', fill('u2', 100)),
            ],
          ],
        ],
      ],
      { ackFails: (id) => id === '1-0' },
    );
    const seen: string[] = [];
    const { logged, log } = lines();
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: async (request) => {
          seen.push(`${request.userId}@${String(request.ltp)}`);
        },
      },
      client,
      shards: 1,
      consumer: 'c1',
      log,
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await vi.waitFor(() => expect(acks().sort()).toEqual(['1-0', '2-0', '3-0']));
    expect(seen.sort()).toEqual(['u1@100', 'u1@99', 'u2@100']);
    expect(logged).toEqual(['Acking matcher fill 1-0 on k0 failed: READONLY replica']);
    await reader.close();
  });

  it('acks the fill in flight before it disconnects, then removes an idle consumer', async () => {
    const { client, calls } = scripted([[['k0', [entry('1-0', fill('u1', 100))]]]]);
    const cleanup = scripted([], { pending: (args) => (args[0] === 'k1' ? [['9-0']] : []) });
    let finish: () => void = () => undefined;
    let started = false;
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: () => {
          started = true;
          return new Promise<void>((resolve) => (finish = resolve));
        },
      },
      client,
      shards: 2,
      consumer: 'c1',
      log: lines().log,
      cleanup: cleanup.client,
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await vi.waitFor(() => expect(started).toBe(true));
    const closing = reader.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.some(([command]) => command === 'disconnect')).toBe(false);
    finish();
    await closing;
    const order = calls
      .map(([command]) => command)
      .filter((c) => c === 'XACK' || c === 'disconnect');
    expect(order).toEqual(['XACK', 'disconnect']);
    // k1 still holds a pending entry of this consumer, which another process must claim.
    expect(cleanup.calls).toEqual([
      ['XPENDING', 'k0', 'api', '-', '+', 1, 'c1'],
      ['XGROUP', 'DELCONSUMER', 'k0', 'api', 'c1'],
      ['XPENDING', 'k1', 'api', '-', '+', 1, 'c1'],
    ]);
  });

  it('disconnects after the grace period when a fill never settles', async () => {
    const { client, calls } = scripted([[['k0', [entry('1-0', fill('u1', 100))]]]]);
    let finish: () => void = () => undefined;
    let started = false;
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: () => {
          started = true;
          return new Promise<void>((resolve) => (finish = resolve));
        },
      },
      client,
      shards: 1,
      consumer: 'c1',
      log: lines().log,
      closeGraceMs: 10,
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await vi.waitFor(() => expect(started).toBe(true));
    const closing = reader.close();
    await vi.waitFor(() => expect(calls.some(([command]) => command === 'disconnect')).toBe(true));
    finish();
    await closing;
  });
});

describe('logFillClientEvents (NSTOCK-0388)', () => {
  it('logs errors at most once per interval with the count left out, and each recovery', () => {
    const client = new EventEmitter();
    let now = 0;
    const { logged, log } = lines();
    logFillClientEvents(client, log, { everyMs: 60_000, now: () => now });

    client.emit('ready');
    client.emit('error', new Error('ECONNREFUSED'));
    now = 1_000;
    client.emit('error', new Error('ECONNREFUSED'));
    client.emit('error', new Error('ECONNREFUSED'));
    now = 61_000;
    client.emit('error', new Error('ETIMEDOUT'));
    client.emit('ready');
    client.emit('ready');

    expect(logged).toEqual([
      'Matcher fill reader Redis ready',
      'Matcher fill reader Redis error: ECONNREFUSED',
      'Matcher fill reader Redis error: ETIMEDOUT (2 more since the last line)',
      'Matcher fill reader Redis ready again',
    ]);
  });
});
