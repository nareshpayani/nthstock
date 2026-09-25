import type {
  CandleRange,
  CandleSeries,
  Depth,
  Exchange,
  IndexSummary,
  Instrument,
  InstrumentStats,
  MoverDirection,
  Movers,
  Quote,
  SearchHit,
  StockList,
} from '@nthstock/contracts';

/** Receives a batch of fresh quotes for the symbols a subscription asked for. */
export type QuoteListener = (quotes: readonly Quote[]) => void;

/** Stops a subscription. Calling it more than once is harmless. */
export type Unsubscribe = () => void;

/**
 * The one seam between nthstock and a market data source (ADR 0004). The mock adapter implements it
 * today; a licensed vendor or broker adapter replaces it later without changes to callers.
 *
 * Conventions:
 * - Prices and index levels are integer paise (index levels in hundredths of a point).
 * - `exchange` is optional on per-instrument calls; when omitted the instrument's primary listing is
 *   used. A lookup that names a different exchange than the instrument's resolves to `null`.
 * - Unknown symbols resolve to `null` (or are skipped in batch calls), never throw.
 */
export interface MarketDataAdapter {
  /** The full symbol master: indices and equities. */
  listInstruments(): Promise<Instrument[]>;
  getInstrument(symbol: string, exchange?: Exchange): Promise<Instrument | null>;

  /** Ranked search: exact symbol, then symbol prefix, then name token. `limit` defaults to 10. */
  search(query: string, limit?: number): Promise<SearchHit[]>;

  getQuote(symbol: string, exchange?: Exchange): Promise<Quote | null>;
  /** Quotes in request order; unknown symbols are skipped. */
  getQuotes(symbols: readonly string[], exchange?: Exchange): Promise<Quote[]>;

  /** Candle history ending at the current price (last close equals LTP). */
  getCandles(symbol: string, range: CandleRange, exchange?: Exchange): Promise<CandleSeries | null>;

  /** Top-5 depth; `null` for unknown symbols and for indices, which do not trade. */
  getDepth(symbol: string, exchange?: Exchange): Promise<Depth | null>;
  /** Key stats; `null` for unknown symbols and for indices. */
  getStats(symbol: string, exchange?: Exchange): Promise<InstrumentStats | null>;

  getIndices(): Promise<IndexSummary[]>;

  getStockLists(): Promise<StockList[]>;
  getStockList(id: string): Promise<StockList | null>;

  /** Gainers (change > 0, descending) or losers (change < 0, ascending) among an index's constituents. */
  getMovers(index: string, direction: MoverDirection, limit?: number): Promise<Movers | null>;

  /**
   * Live ticks for `symbols` (equities or indices). Unknown symbols are ignored. The listener only
   * ever receives quotes for symbols it subscribed to.
   */
  subscribe(symbols: readonly string[], listener: QuoteListener, exchange?: Exchange): Unsubscribe;

  /** Stops timers and drops every subscription. Safe to call more than once. */
  dispose(): void;
}
