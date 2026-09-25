import {
  CandleRange,
  CandleSeries,
  Depth,
  IndexSummary,
  Instrument,
  InstrumentStats,
  Movers,
  Quote,
  SearchHit,
  StockList,
} from '@nthstock/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MarketDataAdapter } from './adapter.js';

export type AdapterContractOptions = {
  /** Suite title suffix, e.g. the adapter's name. */
  name?: string;
  /** A known equity symbol. Default `INFY`. */
  equity?: string;
  /** A known index symbol with constituents. Default `NIFTY50`. */
  index?: string;
  /** A query whose first hit must be `equity`. Default: the first three letters of `equity`, lowercased. */
  searchQuery?: string;
  /**
   * Makes the adapter emit a tick now (e.g. `adapter.tick()` on the mock). Without it the suite waits
   * up to `tickTimeoutMs` for the adapter's own timer.
   */
  triggerTick?: (adapter: MarketDataAdapter) => void | Promise<void>;
  tickTimeoutMs?: number;
};

const UNKNOWN_SYMBOL = 'NOSUCHSYMBOL';

/**
 * A reusable Vitest suite every `MarketDataAdapter` must pass: responses parse with the contract
 * schemas, unknown symbols resolve to null, lists and movers are ordered, candles end at the LTP,
 * and subscriptions deliver only subscribed symbols and stop on unsubscribe. Call it at the top
 * level of a test file.
 */
export function runAdapterContractTests(
  makeAdapter: () => MarketDataAdapter | Promise<MarketDataAdapter>,
  options: AdapterContractOptions = {},
): void {
  const equity = options.equity ?? 'INFY';
  const index = options.index ?? 'NIFTY50';
  const searchQuery = options.searchQuery ?? equity.slice(0, 3).toLowerCase();
  const tickTimeoutMs = options.tickTimeoutMs ?? 3_000;

  describe(`MarketDataAdapter contract${options.name ? `: ${options.name}` : ''}`, () => {
    let adapter: MarketDataAdapter;

    beforeAll(async () => {
      adapter = await makeAdapter();
    });

    afterAll(() => {
      adapter.dispose();
    });

    const tickOnce = async () => {
      if (options.triggerTick) await options.triggerTick(adapter);
    };

    it('lists instruments that parse, with unique tokens and symbols per exchange', async () => {
      const instruments = await adapter.listInstruments();
      expect(instruments.length).toBeGreaterThan(0);
      for (const instrument of instruments) Instrument.parse(instrument);
      expect(new Set(instruments.map((i) => i.token)).size).toBe(instruments.length);
      expect(new Set(instruments.map((i) => `${i.exchange}:${i.symbol}`)).size).toBe(
        instruments.length,
      );
      expect(instruments.some((i) => i.symbol === equity && i.type === 'EQUITY')).toBe(true);
      expect(instruments.some((i) => i.symbol === index && i.type === 'INDEX')).toBe(true);
    });

    it('gets an instrument by symbol and returns null for an unknown one', async () => {
      const instrument = Instrument.parse(await adapter.getInstrument(equity));
      expect(instrument.symbol).toBe(equity);
      expect(await adapter.getInstrument(UNKNOWN_SYMBOL)).toBeNull();
      const other = instrument.exchange === 'NSE' ? 'BSE' : 'NSE';
      expect(await adapter.getInstrument(equity, other)).toBeNull();
    });

    it('searches with the equity first for its own prefix, within the limit', async () => {
      const hits = await adapter.search(searchQuery, 5);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.length).toBeLessThanOrEqual(5);
      for (const hit of hits) SearchHit.parse(hit);
      expect(hits[0]?.symbol).toBe(equity);
      expect(await adapter.search('zzzzqqqq')).toEqual([]);
    });

    it('returns quotes that parse, null for unknown, batches in request order', async () => {
      const quote = Quote.parse(await adapter.getQuote(equity));
      expect(quote.symbol).toBe(equity);
      expect(quote.change).toBe(quote.ltp - quote.prevClose);
      expect(quote.low).toBeLessThanOrEqual(quote.ltp);
      expect(quote.high).toBeGreaterThanOrEqual(quote.ltp);
      expect(await adapter.getQuote(UNKNOWN_SYMBOL)).toBeNull();

      const batch = await adapter.getQuotes([index, UNKNOWN_SYMBOL, equity]);
      expect(batch.map((q) => q.symbol)).toEqual([index, equity]);
      for (const q of batch) Quote.parse(q);
    });

    it.each(CandleRange.options)('returns %s candles that end at the LTP', async (range) => {
      const series = CandleSeries.parse(await adapter.getCandles(equity, range));
      const quote = Quote.parse(await adapter.getQuote(equity));
      expect(series.range).toBe(range);
      expect(series.candles.length).toBeGreaterThan(0);
      expect(series.candles.at(-1)?.c).toBe(quote.ltp);
      const times = series.candles.map((c) => Date.parse(c.t));
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]).toBeGreaterThan(times[i - 1] as number);
      }
    });

    it('returns candles for an index and null for an unknown symbol', async () => {
      CandleSeries.parse(await adapter.getCandles(index, '1D'));
      expect(await adapter.getCandles(UNKNOWN_SYMBOL, '1D')).toBeNull();
    });

    it('returns ordered top-5 depth for an equity, null for an index or unknown', async () => {
      const depth = Depth.parse(await adapter.getDepth(equity));
      const bids = depth.bids.map((l) => l.price);
      const asks = depth.asks.map((l) => l.price);
      expect([...bids].sort((a, b) => b - a)).toEqual(bids);
      expect([...asks].sort((a, b) => a - b)).toEqual(asks);
      expect(bids[0]).toBeLessThan(asks[0] as number);
      expect(await adapter.getDepth(index)).toBeNull();
      expect(await adapter.getDepth(UNKNOWN_SYMBOL)).toBeNull();
    });

    it('returns stats consistent with the quote, null for unknown', async () => {
      const stats = InstrumentStats.parse(await adapter.getStats(equity));
      const quote = Quote.parse(await adapter.getQuote(equity));
      expect(stats.prevClose).toBe(quote.prevClose);
      expect(stats.lowerCircuit).toBeLessThanOrEqual(quote.ltp);
      expect(stats.upperCircuit).toBeGreaterThanOrEqual(quote.ltp);
      expect(stats.week52Low).toBeLessThanOrEqual(stats.week52High);
      expect(await adapter.getStats(UNKNOWN_SYMBOL)).toBeNull();
    });

    it('returns index summaries that parse, including the known index', async () => {
      const indices = await adapter.getIndices();
      for (const summary of indices) IndexSummary.parse(summary);
      const known = indices.find((s) => s.symbol === index);
      expect(known).toBeDefined();
      expect(known?.sparkline.at(-1)).toBe(known?.value);
    });

    it('returns curated lists that parse, each fetchable by id', async () => {
      const lists = await adapter.getStockLists();
      expect(lists.length).toBeGreaterThan(0);
      for (const list of lists) {
        StockList.parse(list);
        expect(list.items.length).toBeGreaterThan(0);
        expect(await adapter.getStockList(list.id)).toEqual(list);
      }
      expect(await adapter.getStockList('no-such-list')).toBeNull();
    });

    it('ranks movers: gainers descending and positive, losers ascending and negative', async () => {
      const gainers = Movers.parse(await adapter.getMovers(index, 'gainers', 5));
      const losers = Movers.parse(await adapter.getMovers(index, 'losers', 5));
      expect(gainers.items.length).toBeLessThanOrEqual(5);
      const g = gainers.items.map((r) => r.changeBp);
      const l = losers.items.map((r) => r.changeBp);
      expect([...g].sort((a, b) => b - a)).toEqual(g);
      expect([...l].sort((a, b) => a - b)).toEqual(l);
      expect(g.every((bp) => bp > 0)).toBe(true);
      expect(l.every((bp) => bp < 0)).toBe(true);
      expect(await adapter.getMovers(UNKNOWN_SYMBOL, 'gainers')).toBeNull();
    });

    it(
      'delivers ticks only for subscribed symbols and stops after unsubscribe',
      async () => {
        const batches: (readonly Quote[])[] = [];
        let resolveFirst: () => void = () => undefined;
        const first = new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
        const unsubscribe = adapter.subscribe([equity, index, UNKNOWN_SYMBOL], (quotes) => {
          batches.push(quotes);
          resolveFirst();
        });
        await tickOnce();
        await first;
        unsubscribe();
        unsubscribe();

        const seen = batches.flat();
        expect(seen.length).toBeGreaterThan(0);
        for (const quote of seen) Quote.parse(quote);
        expect(new Set(seen.map((q) => q.symbol))).toEqual(new Set([equity, index]));

        const count = batches.length;
        await tickOnce();
        expect(batches.length).toBe(count);
      },
      tickTimeoutMs + 1_000,
    );

    it(
      'keeps separate subscriptions independent',
      async () => {
        const a: string[] = [];
        const b: string[] = [];
        let resolveBoth: () => void = () => undefined;
        const both = new Promise<void>((resolve) => {
          resolveBoth = resolve;
        });
        const check = () => {
          if (a.length > 0 && b.length > 0) resolveBoth();
        };
        const stopA = adapter.subscribe([equity], (quotes) => {
          a.push(...quotes.map((q) => q.symbol));
          check();
        });
        const stopB = adapter.subscribe([index], (quotes) => {
          b.push(...quotes.map((q) => q.symbol));
          check();
        });
        await tickOnce();
        await both;
        stopA();
        stopB();
        expect(new Set(a)).toEqual(new Set([equity]));
        expect(new Set(b)).toEqual(new Set([index]));
      },
      tickTimeoutMs + 1_000,
    );
  });
}
