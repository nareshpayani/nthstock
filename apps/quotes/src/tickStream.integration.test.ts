import {
  TickStreamEntry,
  tickStreamStep,
  type Quote,
  type TickStreamEntry as Entry,
} from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createRedisTickSink } from './tickStream.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from './test/testRedis.js';

const quote = (token: number, ltp: number): Quote => ({
  token,
  symbol: `SYM${String(token)}`,
  exchange: 'NSE',
  ltp,
  change: 0,
  changeBp: 0,
  open: ltp,
  high: ltp,
  low: ltp,
  prevClose: ltp,
  volume: 1,
  ts: '2026-09-28T05:00:00.000Z',
});

const entry = (seq: number, quotes: Quote[]): Entry => ({ v: 1, shard: 0, seq, quotes });

describeWithRedis('tick streams on real Redis (integration)', () => {
  let server: TestRedis | undefined;
  let redis: Redis;

  beforeAll(async () => {
    server = await startTestRedis();
    redis = new Redis(server.url);
  }, 180_000);

  afterAll(async () => {
    await redis.quit();
    await server?.stop();
  });

  function keys() {
    const prefix = uniqueChannel('test');
    const stream = `${prefix}:ticks`;
    const snapshot = `${prefix}:last`;
    return {
      stream,
      snapshot,
      sink: createRedisTickSink({ redis, streamKey: () => stream, snapshotKey: () => snapshot }),
    };
  }

  /** The stream's entries after `from` (an entry id), parsed. */
  async function readAfter(stream: string, from: string) {
    const rows = await redis.xrange(stream, `(${from}`, '+');
    return rows.map(([id, fields]) => ({
      id,
      entry: TickStreamEntry.parse(JSON.parse(fields[1] ?? '')),
    }));
  }

  it('appends each batch to the stream and keeps the newest quote per token', async () => {
    const { stream, snapshot, sink } = keys();
    await sink.append(entry(1, [quote(1, 100), quote(2, 200)]));
    await sink.append(entry(2, [quote(1, 101)]));

    const read = await readAfter(stream, '0-0');
    expect(read.map(({ entry }) => entry.seq)).toEqual([1, 2]);
    const last = await redis.hgetall(snapshot);
    expect(Object.keys(last).sort()).toEqual(['1', '2']);
    expect((JSON.parse(last['1'] ?? '') as Quote).ltp).toBe(101);
    expect((JSON.parse(last['2'] ?? '') as Quote).ltp).toBe(200);
  });

  it('trims the stream to about TICK_STREAM_MAXLEN entries', async () => {
    const { stream, sink } = keys();
    for (let seq = 1; seq <= 2_600; seq += 1) await sink.append(entry(seq, [quote(1, seq)]));
    const length = await redis.xlen(stream);
    expect(length).toBeGreaterThanOrEqual(2_400);
    expect(length).toBeLessThan(2_600);
  });

  it('lets a consumer that missed entries catch up from the snapshot', async () => {
    const { stream, snapshot, sink } = keys();
    await sink.append(entry(1, [quote(1, 100), quote(2, 200)]));
    const [first] = await readAfter(stream, '0-0');
    // The consumer applied seq 1. Then entries 2 and 3 are trimmed away before it reads again.
    const prices = new Map<number, number>(
      (first?.entry.quotes ?? []).map((q) => [q.token, q.ltp]),
    );
    let lastSeq = first?.entry.seq ?? null;
    await sink.append(entry(2, [quote(2, 210)]));
    await sink.append(entry(3, [quote(1, 130)]));
    await redis.xtrim(stream, 'MAXLEN', 0);
    await sink.append(entry(4, [quote(1, 140)]));

    for (const { entry: next } of await readAfter(stream, first?.id ?? '0-0')) {
      if (tickStreamStep(lastSeq, next) === 'resync') {
        for (const json of Object.values(await redis.hgetall(snapshot))) {
          const latest = JSON.parse(json) as Quote;
          prices.set(latest.token, latest.ltp);
        }
      }
      for (const q of next.quotes) prices.set(q.token, q.ltp);
      lastSeq = next.seq;
    }

    // Token 2's move in the trimmed entry 2 came back from the snapshot.
    expect(Object.fromEntries(prices)).toEqual({ 1: 140, 2: 210 });
  });
});
