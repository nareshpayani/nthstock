import { TICK_BATCH_VERSION, type Quote, type TickStreamEntry } from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from '../../db/client.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { startTestRedis, uniqueChannel, type TestRedis } from '../../test/testRedis.js';
import { startCandleWriter, type CandleWriter, type CandleWriterLog } from './candleWriter.js';
import { createPgCandleStore, type CandleStore, type StoredBar } from './store.js';

// The candle writer on real Postgres (TimescaleDB) and Redis (NSTOCK-0373, spec
// market-data-and-matching §7.2): a restart loses no minute and counts none twice, and each minute
// is one INSERT.

const T0 = Date.parse('2026-10-23T04:00:00.000Z'); // 09:30 IST
const MINUTE_MS = 60_000;
const STEP_MS = 15_000; // four batches a minute per shard
const SHARDS = 2;
/** Tokens 1 and 2 on shard 0, 3 and 4 on shard 1. */
const TOKENS_OF: Record<number, number[]> = { 0: [1, 2], 1: [3, 4] };
const TOKENS = [1, 2, 3, 4];
const silent = { info: () => undefined, warn: () => undefined };

const quoteAt = (token: number, step: number): Quote => {
  const ltp = 100_000 + token * 1_000 + ((step * 37 * token) % 211) - 100;
  return {
    token,
    symbol: `SYM${String(token)}`,
    exchange: 'NSE',
    ltp,
    change: 0,
    changeBp: 0,
    open: 100_000,
    high: 200_000,
    low: 50_000,
    prevClose: 100_000,
    // Cumulative day volume, rising by a different amount each step.
    volume: 5_000 * token + step * (token * 3 + 1) + ((step * step) % 7),
    ts: new Date(T0 + step * STEP_MS).toISOString(),
  };
};

/** Both shards' entries, in time order, for steps `[from, to)` (step 16 is minute 4). */
const entries = (from: number, to: number): TickStreamEntry[] =>
  Array.from({ length: to - from }, (_, index) => from + index).flatMap((step) =>
    [0, 1].map((shard) => ({
      v: TICK_BATCH_VERSION,
      shard,
      seq: step + 1,
      quotes: (TOKENS_OF[shard] ?? []).map((token) => quoteAt(token, step)),
    })),
  );

const MINUTE = (n: number) => new Date(T0 + n * MINUTE_MS);

describeWithPostgres('candle writer (integration)', () => {
  let pg: TestPostgres;
  let redis: TestRedis;
  let database: Database;
  let store: CandleStore;
  let producer: Redis;
  let prefix = '';
  const streamKey = (shard: number) => `${prefix}:ticks:${String(shard)}`;
  const writtenKey = (shard: number) => `${prefix}:written:${String(shard)}`;
  const writers: CandleWriter[] = [];

  beforeAll(async () => {
    [pg, redis] = await Promise.all([useTestPostgres(), startTestRedis()]);
    database = createDatabase({ url: pg.appUrl });
    store = createPgCandleStore({ database });
    producer = new Redis(redis.url);
  }, 180_000);

  afterAll(async () => {
    producer.disconnect();
    await database.close();
    await redis.stop();
  });

  beforeEach(async () => {
    prefix = uniqueChannel('test:candles');
    await pg.truncate();
  });

  afterEach(async () => {
    for (const writer of writers.splice(0)) await writer.close();
  });

  async function append(batch: readonly TickStreamEntry[]) {
    for (const entry of batch) {
      await producer.xadd(streamKey(entry.shard), '*', 'batch', JSON.stringify(entry));
    }
  }

  /** The buckets of every `upsertMinuteBars` call that completed, in order. */
  function countingStore(inner: Pick<CandleStore, 'upsertMinuteBars'> = store) {
    const calls: string[] = [];
    return {
      calls,
      store: {
        upsertMinuteBars: async (bars: readonly StoredBar[]) => {
          const buckets = new Set(bars.map((bar) => bar.bucket.toISOString()));
          expect(buckets.size).toBe(1);
          await inner.upsertMinuteBars(bars);
          calls.push([...buckets][0] ?? '');
        },
      },
    };
  }

  async function start(
    target: Pick<CandleStore, 'upsertMinuteBars'>,
    options: { shards?: number; clock?: ManualClock; log?: CandleWriterLog } = {},
  ) {
    const writer = startCandleWriter({
      redis: new Redis(redis.url, { maxRetriesPerRequest: null }),
      store: target,
      shards: options.shards ?? SHARDS,
      streamKey,
      writtenKey,
      clock: options.clock ?? manualClock(T0),
      blockMs: 50,
      log: options.log ?? silent,
    });
    writers.push(writer);
    await writer.ready();
    return writer;
  }

  const waitForCalls = (calls: readonly string[], count: number) =>
    vi.waitFor(() => expect(calls).toHaveLength(count), { timeout: 10_000, interval: 20 });

  /** `bucket` comes back from the driver as text; compared as a Date. */
  const readBars = async (token: number, from: Date, to: Date) =>
    (await store.readBars(token, '1m', from, to)).map((bar) => ({
      ...bar,
      bucket: new Date(bar.bucket),
    }));

  const storedBars = async () =>
    (await Promise.all(TOKENS.map((token) => readBars(token, MINUTE(0), MINUTE(10))))).flat();

  /** Waits until the writer has recorded `minute` as written (after its INSERT). */
  const waitForWritten = (minute: number) =>
    vi.waitFor(
      async () =>
        expect(await producer.get(writtenKey(0))).toBe(
          String(MINUTE(minute).getTime() / MINUTE_MS),
        ),
      { timeout: 10_000, interval: 20 },
    );

  const pendingCount = async (shard: number) =>
    Number(((await producer.xpending(streamKey(shard), 'candles')) as [number])[0]);

  const allBuckets = [0, 1, 2, 3].map((n) => MINUTE(n).toISOString());

  /** Minutes 0 to 3 without a restart; the first entry of minute 4 closes minute 3. */
  async function uninterrupted(): Promise<StoredBar[]> {
    const counting = countingStore();
    const writer = await start(counting.store);
    await append(entries(0, 17));
    await waitForCalls(counting.calls, 4);
    await waitForWritten(3);
    expect(counting.calls).toEqual(allBuckets);
    await writer.close();
    const bars = await storedBars();
    await pg.truncate();
    prefix = uniqueChannel('test:candles');
    return bars;
  }

  it('writes each closed minute once, with every shard, and volumes from the cumulative', async () => {
    const bars = await uninterrupted();
    expect(bars).toHaveLength(16);
    for (const token of TOKENS) {
      const own = bars.filter((bar) => bar.token === token);
      expect(own.map((bar) => bar.bucket)).toEqual([0, 1, 2, 3].map(MINUTE));
      // The first cumulative is the baseline; the four minutes add up to what traded after it.
      const traded = own.reduce((sum, bar) => sum + bar.volume, 0);
      expect(traded).toBe(quoteAt(token, 15).volume - quoteAt(token, 0).volume);
      expect(own[1]).toMatchObject({
        open: quoteAt(token, 4).ltp,
        close: quoteAt(token, 7).ltp,
        volume: quoteAt(token, 7).volume - quoteAt(token, 3).volume,
        high: Math.max(...[4, 5, 6, 7].map((step) => quoteAt(token, step).ltp)),
        low: Math.min(...[4, 5, 6, 7].map((step) => quoteAt(token, step).ltp)),
      });
    }
  });

  it('a writer killed mid-minute and restarted stores what an uninterrupted run does', async () => {
    const expected = await uninterrupted();

    const counting = countingStore();
    const first = await start(counting.store);
    // Minutes 0 to 2 and half of minute 3: minutes 0, 1 and 2 are written.
    await append(entries(0, 14));
    await waitForWritten(2);
    await first.close();

    await append(entries(14, 17));
    await start(counting.store);
    await waitForCalls(counting.calls, 4);

    expect(counting.calls).toEqual(allBuckets);
    expect(await storedBars()).toEqual(expected);
    // Minutes 0 to 2 are acknowledged; minute 3 stays pending as the baseline, minute 4 forms.
    await waitForWritten(3);
    await vi.waitFor(async () => {
      for (const shard of [0, 1]) expect(await pendingCount(shard)).toBe(4 + 1);
    });
  });

  it('a crash between the INSERT and the written mark rewrites that minute with the same values', async () => {
    const expected = await uninterrupted();

    const counting = countingStore();
    let hung = false;
    // Minute 1 reaches Postgres, then the process dies before it records the minute in Redis.
    const crashing = countingStore({
      upsertMinuteBars: async (bars) => {
        await store.upsertMinuteBars(bars);
        if (bars[0]?.bucket.getTime() === MINUTE(1).getTime()) {
          hung = true;
          await new Promise<never>(() => undefined);
        }
      },
    });
    const first = await start(crashing.store);
    await append(entries(0, 17));
    await vi.waitFor(() => expect(hung).toBe(true), { timeout: 10_000, interval: 20 });
    await first.close();
    expect(crashing.calls).toEqual(allBuckets.slice(0, 1));
    expect(await producer.get(writtenKey(0))).toBe(String(MINUTE(0).getTime() / MINUTE_MS));

    await start(counting.store);
    await waitForCalls(counting.calls, 3);
    expect(counting.calls).toEqual(allBuckets.slice(1));
    expect(await storedBars()).toEqual(expected);
  });

  it('writes a minute on the idle timer when no tick moves past it, and acks malformed entries', async () => {
    const clock = manualClock(T0 + 30_000);
    const warnings: string[] = [];
    const log = { info: () => undefined, warn: (message: string) => void warnings.push(message) };
    const counting = countingStore();
    await producer.xadd(streamKey(0), '*', 'batch', 'not json');
    await append(entries(0, 4).filter((entry) => entry.shard === 0));
    await start(counting.store, { shards: 1, clock, log });

    // Five seconds' grace after the minute ends.
    clock.advance(34_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(counting.calls).toEqual([]);
    clock.advance(1_000);
    await waitForCalls(counting.calls, 1);
    expect(counting.calls).toEqual([MINUTE(0).toISOString()]);
    expect(warnings).toContain('Skipped a malformed or trimmed tick stream entry');
    // The malformed entry is acknowledged with the write; minute 0's four stay as the baseline.
    await vi.waitFor(async () => expect(await pendingCount(0)).toBe(4));

    // A late tick of the written minute is not written again; the next minute counts it.
    const shard0 = (step: number, seq: number) =>
      entries(step, step + 1)
        .filter((entry) => entry.shard === 0)
        .map((entry) => ({ ...entry, seq }));
    await append(shard0(3, 5));
    await append(shard0(4, 6));
    clock.advance(MINUTE_MS);
    await waitForCalls(counting.calls, 2);
    const bars = await readBars(1, MINUTE(0), MINUTE(2));
    expect(bars.map((bar) => bar.volume)).toEqual([
      quoteAt(1, 3).volume - quoteAt(1, 0).volume,
      quoteAt(1, 4).volume - quoteAt(1, 3).volume,
    ]);
  });
});

describe('candle writer without its servers', () => {
  it('closes at once when Redis cannot be reached', async () => {
    const writer = startCandleWriter({
      redis: new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 1, lazyConnect: true }),
      store: { upsertMinuteBars: () => Promise.resolve() },
      shards: 1,
    });
    await writer.close();
    await expect(writer.ready()).resolves.toBeUndefined();
  });
});
