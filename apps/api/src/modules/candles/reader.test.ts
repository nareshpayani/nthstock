import type { Quote } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster, historyCalendar } from '@nthstock/marketData';
import { fixedClock, fromIst } from '@nthstock/utils';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createCandleReader } from './reader.js';
import { seedRows } from './seed.js';
import type { CandleStore, StoredBar, StoredInterval } from './store.js';

// The candles route's reader over a store in memory (the Postgres one is in
// candles.integration.test.ts): which bars it reads, and where the live quote comes from.

const master = generateSymbolMaster({ equityCount: 60 });
// Monday 26 Oct 2026, 08:00 IST: closed, so the charts end with Friday 23 Oct.
const clock = fixedClock(fromIst(2026, 10, 26, 8 * 60));
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };
const market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
const calendar = historyCalendar(fromIst(2026, 10, 23, 16 * 60), { years: 1 });

/** Holds `candles_1m` rows; any other bar size reads as the 1-minute rows (enough here). */
function memoryStore(rows: StoredBar[]): CandleStore & { reads: StoredInterval[] } {
  const reads: StoredInterval[] = [];
  return {
    reads,
    upsertMinuteBars: () => Promise.resolve(),
    insertMinuteBarsIfAbsent: () => Promise.resolve(),
    readBars(token, interval, from, to) {
      reads.push(interval);
      return Promise.resolve(
        rows.filter(
          (bar) =>
            bar.token === token &&
            bar.bucket.getTime() >= from.getTime() &&
            bar.bucket.getTime() < to.getTime(),
        ),
      );
    },
  };
}

afterAll(() => {
  market.dispose();
});

describe('createCandleReader', () => {
  const store = memoryStore(seedRows(master, 'INFY', calendar, true));

  it('is null for an unknown symbol, as the adapter is', async () => {
    const reader = createCandleReader({ store, market, quotes: null, clock });
    expect(await reader.getCandles('NOPE', '1D')).toBeNull();
    expect(await reader.getCandles('INFY', '1D', 'BSE')).toBeNull();
  });

  it('closes the last stored bar at the quote service LTP when it runs', async () => {
    const own = await market.getQuote('INFY');
    const pinned = { ...(own as Quote), ltp: (own?.ltp ?? 0) + 500 };
    const quotes = { getQuotes: () => Promise.resolve([pinned]) };
    const reader = createCandleReader({ store, market, quotes, clock });
    const series = await reader.getCandles('INFY', '1D');
    expect(series?.candles).toHaveLength(375);
    expect(series?.candles.at(-1)?.c).toBe(pinned.ltp);
    expect(series?.candles.at(-1)?.h).toBeGreaterThanOrEqual(pinned.ltp);
    // And on the adapter's own quote without it.
    const own2 = await createCandleReader({ store, market, quotes: null, clock }).getCandles(
      'INFY',
      '1D',
    );
    expect(own2?.candles.at(-1)?.c).toBe(own?.ltp);
  });

  it('reads days for 1w and groups them into weeks', async () => {
    const reader = createCandleReader({ store, market, quotes: null, clock });
    store.reads.length = 0;
    const series = await reader.getCandles('INFY', '1Y', undefined, '1w');
    expect(store.reads).toEqual(['1d']);
    expect(series?.interval).toBe('1w');
    const weekdays = new Set(series?.candles.map((bar) => new Date(bar.t).getUTCDay()));
    const days = await reader.getCandles('INFY', '1Y');
    // A year of history: about 52 weeks of about 5 days each.
    expect(series?.candles.length).toBeGreaterThan(50);
    expect(series?.candles.length).toBeLessThan(56);
    expect((days?.candles.length ?? 0) / (series?.candles.length ?? 1)).toBeGreaterThan(4);
    expect(weekdays.size).toBeGreaterThan(0);
  });

  it('falls back to the generator when the store has nothing for the window', async () => {
    const reader = createCandleReader({ store: memoryStore([]), market, quotes: null, clock });
    expect(await reader.getCandles('INFY', '1M', undefined, '1d')).toEqual(
      await market.getCandles('INFY', '1M', undefined, '1d'),
    );
  });
});

describe('the candles route', () => {
  it('serves the adapter bars on the memory driver, with no candle store', async () => {
    const app = buildApp({ deps: { clock, market } });
    try {
      expect(app.deps.candleStore).toBeNull();
      const response = await app.inject({
        method: 'GET',
        url: '/v1/market/instruments/INFY/candles?range=1W',
      });
      expect(response.json()).toEqual(await market.getCandles('INFY', '1W'));
    } finally {
      await app.close();
    }
  });

  it('reads an injected candle store', async () => {
    const store = memoryStore(seedRows(master, 'INFY', calendar, true));
    const app = buildApp({ deps: { clock, market, candleStore: store } });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/market/instruments/INFY/candles?range=1D&interval=5m',
      });
      expect(response.statusCode).toBe(200);
      expect(store.reads).toEqual(['5m']);
    } finally {
      await app.close();
    }
  });
});
