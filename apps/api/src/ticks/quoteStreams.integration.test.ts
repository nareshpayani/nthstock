import { BatchQuotesResponse, TICK_BATCH_VERSION, routes, type Quote } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../app.js';
import { manualClock } from '../test/manualClock.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from '../test/testRedis.js';
import type { Publisher } from './publisher.js';

// apps/api on the quote service (NSTOCK-0354, spec market-data-and-matching §4 and acceptance
// criterion 1): every instance answers the LTP apps/quotes last wrote, and none ticks on its own.

const SHARDS = 2;
const master = generateSymbolMaster({ equityCount: 20 });
const EQUITY = master.equities[0]?.instrument;
const SYMBOL = EQUITY?.symbol ?? '';
const TOKEN = EQUITY?.token ?? 0;
const SHARD = shardOf(TOKEN, SHARDS);
const silent = { info: () => undefined, warn: () => undefined };

describeWithRedis('apps/api on the quote service (integration, NSTOCK-0354)', () => {
  let redis: TestRedis;
  let writer: Redis;
  const apps: App[] = [];
  let prefix = '';
  const streamKey = (shard: number) => `${prefix}:ticks:${String(shard)}`;
  const snapshotKey = (shard: number) => `${prefix}:last:${String(shard)}`;

  beforeAll(async () => {
    redis = await startTestRedis();
    writer = new Redis(redis.url);
  }, 120_000);
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });
  afterAll(async () => {
    writer.disconnect();
    await redis.stop();
  });

  /** What apps/quotes writes for one batch: the stream entry and the snapshot, together. */
  async function write(seq: number, quote: Quote) {
    const batch = { v: TICK_BATCH_VERSION, shard: SHARD, seq, quotes: [quote] };
    await writer
      .multi()
      .xadd(streamKey(SHARD), '*', 'batch', JSON.stringify(batch))
      .hset(snapshotKey(SHARD), String(quote.token), JSON.stringify(quote))
      .exec();
  }

  async function boot(tickPublisher?: Publisher) {
    const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
    const market = new MockMarketDataAdapter({ master, clock, externalTicks: true });
    const app = buildApp({
      deps: {
        clock,
        market,
        quoteStreams: {
          url: redis.url,
          shards: SHARDS,
          streamKey,
          snapshotKey,
          blockMs: 100,
          log: silent,
        },
      },
      orderSweepMs: null,
      ...(tickPublisher ? { tickPublisher } : {}),
    });
    app.addHook('onClose', () => market.dispose());
    apps.push(app);
    await app.ready();
    return app;
  }

  const ltpOn = async (app: App) => {
    const response = await app.inject({
      method: 'GET',
      url: `${routes.marketQuotes.path}?symbols=${SYMBOL}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return BatchQuotesResponse.parse(response.json()).items[0]?.ltp;
  };

  it('answers the same LTP on two instances, from the snapshot, and follows new batches', async () => {
    prefix = uniqueChannel('quotes-api');
    const base = (await new MockMarketDataAdapter({ master }).getQuote(SYMBOL)) as Quote;
    const quote = (ltp: number): Quote => ({ ...base, ltp, change: ltp - base.prevClose });
    await write(1, quote(123_455));

    const [one, two] = [await boot(), await boot()];

    expect([await ltpOn(one), await ltpOn(two)]).toEqual([123_455, 123_455]);
    // The adapter starts from the snapshot too, so the desk and the lists see the same price.
    expect((await one.deps.market.getQuote(SYMBOL))?.ltp).toBe(123_455);

    await write(2, quote(123_500));
    await vi.waitFor(async () => {
      expect((await two.deps.market.getQuote(SYMBOL))?.ltp).toBe(123_500);
    });
    expect([await ltpOn(one), await ltpOn(two)]).toEqual([123_500, 123_500]);
  });

  it('generates no ticks of its own and starts no tick pump', async () => {
    prefix = uniqueChannel('quotes-api');
    const publish = vi.fn(() => Promise.resolve());
    const app = await boot({ publish, close: () => Promise.resolve() });
    const received: Quote[] = [];
    const unsubscribe = app.deps.market.subscribe([SYMBOL], (quotes) => received.push(...quotes));

    await new Promise((resolve) => setTimeout(resolve, 1_300));
    unsubscribe();

    expect(received).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });
});
