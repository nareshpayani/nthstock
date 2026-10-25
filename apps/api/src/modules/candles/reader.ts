import type {
  Candle,
  CandleInterval,
  CandleRange,
  CandleSeries,
  Exchange,
  Quote,
} from '@nthstock/contracts';
import { resampleCandles, type MarketDataAdapter } from '@nthstock/marketData';
import type { Clock, HolidayTable } from '@nthstock/utils';
import type { CandleStore, StoredBar } from './store.js';
import { candleWindow, dropDailyOnlySessions, withLiveQuote } from './window.js';

/** Where the live quote comes from: the quote service's snapshots, or the adapter itself. */
export type LiveQuotes = Pick<MarketDataAdapter, 'getQuotes'>;

export type CandleReader = {
  /** The same answer as `MarketDataAdapter.getCandles`, from stored bars when there are any. */
  getCandles(
    symbol: string,
    range: CandleRange,
    exchange?: Exchange,
    interval?: CandleInterval,
  ): Promise<CandleSeries | null>;
};

export type CandleReaderOptions = {
  store: CandleStore;
  market: MarketDataAdapter;
  /** `quotes:last` through the quote service when it runs; null: the adapter's own quote. */
  quotes: LiveQuotes | null;
  clock: Clock;
  holidays?: HolidayTable;
};

const toCandle = (bar: StoredBar): Candle => ({
  t: bar.bucket.toISOString(),
  o: bar.open,
  h: bar.high,
  l: bar.low,
  c: bar.close,
  v: bar.volume,
});

/**
 * The candles route on TimescaleDB (NSTOCK-0375, spec market-data-and-matching §7.3): 1-minute
 * bars from `candles_1m`, 5 minutes to 1 hour from the aggregates, days from `candles_1d` and weeks
 * by grouping those days, over the generator's window for the range, with the forming bar built
 * from the live quote. A symbol the store holds no bars for in the window (not seeded, or a
 * session the candle writer has not reached) gets the generator's bars, as before.
 */
export function createCandleReader(options: CandleReaderOptions): CandleReader {
  const { store, market, clock } = options;
  const quotes = options.quotes ?? market;
  return {
    async getCandles(symbol, range, exchange, interval) {
      const instrument = await market.getInstrument(symbol, exchange);
      if (!instrument) return null;
      const window = candleWindow(range, interval, clock, options.holidays);
      const rows = await store.readBars(instrument.token, window.stored, window.from, window.to);
      const bars = dropDailyOnlySessions(rows.map(toCandle), window);
      if (bars.length === 0) return market.getCandles(symbol, range, exchange, interval);
      const [quote] = await quotes.getQuotes([instrument.symbol], instrument.exchange);
      const live = withLiveQuote(bars, (quote as Quote | undefined) ?? null, window);
      return {
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        range,
        interval: window.interval,
        candles: window.interval === '1w' ? resampleCandles(live, '1w') : live,
      };
    },
  };
}
