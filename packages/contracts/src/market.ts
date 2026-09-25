import { z } from 'zod';
import {
  BasisPoints,
  Count,
  Exchange,
  InstrumentToken,
  IsoUtc,
  NonNegativePaise,
  Paise,
  TickPrice,
  TradingSymbol,
} from './primitives.js';

export const InstrumentType = z.enum(['EQUITY', 'INDEX']);
export type InstrumentType = z.infer<typeof InstrumentType>;

/** Symbol master entry. */
export const Instrument = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  name: z.string().min(1).max(120),
  type: InstrumentType,
  /** 12-char ISIN for equities; null for indices. */
  isin: z
    .string()
    .regex(/^IN[A-Z0-9]{10}$/)
    .nullable(),
  sector: z.string().min(1).max(60).nullable(),
  lotSize: z.number().int().min(1),
  tickSize: TickPrice,
});
export type Instrument = z.infer<typeof Instrument>;

/** Search result row: the parts of an instrument a search list shows. */
export const SearchHit = Instrument.pick({
  token: true,
  symbol: true,
  exchange: true,
  name: true,
  type: true,
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SEARCH_QUERY_MAX = 50;
export const SEARCH_LIMIT_MAX = 50;

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(SEARCH_QUERY_MAX),
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResponse = z.object({ items: z.array(SearchHit) });
export type SearchResponse = z.infer<typeof SearchResponse>;

/** Live price snapshot. Prices in paise, change in paise and basis points. */
export const Quote = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  ltp: NonNegativePaise,
  change: Paise,
  changeBp: BasisPoints,
  open: NonNegativePaise,
  high: NonNegativePaise,
  low: NonNegativePaise,
  prevClose: NonNegativePaise,
  volume: Count,
  ts: IsoUtc,
});
export type Quote = z.infer<typeof Quote>;

export const BATCH_QUOTES_MAX = 50;

/** `?symbols=INFY,TCS` → `['INFY', 'TCS']`, 1–50 symbols. */
export const BatchQuotesQuery = z.object({
  symbols: z
    .string()
    .transform((value) => value.split(',').map((s) => s.trim()))
    .pipe(z.array(TradingSymbol).min(1).max(BATCH_QUOTES_MAX)),
  exchange: Exchange.optional(),
});
export type BatchQuotesQuery = z.infer<typeof BatchQuotesQuery>;

export const BatchQuotesResponse = z.object({ items: z.array(Quote) });
export type BatchQuotesResponse = z.infer<typeof BatchQuotesResponse>;

/** Key stats and fundamentals for stock detail. */
export const InstrumentStats = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  open: NonNegativePaise,
  high: NonNegativePaise,
  low: NonNegativePaise,
  prevClose: NonNegativePaise,
  volume: Count,
  week52High: NonNegativePaise,
  week52Low: NonNegativePaise,
  upperCircuit: NonNegativePaise,
  lowerCircuit: NonNegativePaise,
  /** Market capitalisation in paise; null for indices. */
  marketCap: NonNegativePaise.nullable(),
  /** Price-to-earnings ratio × 100 (24.53 → 2453); null when not meaningful. */
  peX100: z.number().int().nullable(),
  dividendYieldBp: BasisPoints.min(0).nullable(),
  asOf: IsoUtc,
});
export type InstrumentStats = z.infer<typeof InstrumentStats>;

export const CandleRange = z.enum(['1D', '1W', '1M', '1Y', '5Y']);
export type CandleRange = z.infer<typeof CandleRange>;

export const CandleInterval = z.enum(['1m', '5m', '15m', '1h', '1d', '1w']);
export type CandleInterval = z.infer<typeof CandleInterval>;

/** One OHLCV bar; `t` is the bar's open time. */
export const Candle = z
  .object({
    t: IsoUtc,
    o: NonNegativePaise,
    h: NonNegativePaise,
    l: NonNegativePaise,
    c: NonNegativePaise,
    v: Count,
  })
  .refine((k) => k.l <= Math.min(k.o, k.c) && k.h >= Math.max(k.o, k.c), {
    error: 'Candle low/high must bound open and close',
  });
export type Candle = z.infer<typeof Candle>;

export const CandlesQuery = z.object({ range: CandleRange, exchange: Exchange.optional() });
export type CandlesQuery = z.infer<typeof CandlesQuery>;

export const CandleSeries = z.object({
  symbol: TradingSymbol,
  exchange: Exchange,
  range: CandleRange,
  interval: CandleInterval,
  candles: z.array(Candle),
});
export type CandleSeries = z.infer<typeof CandleSeries>;

export const DEPTH_LEVELS = 5;

export const DepthLevel = z.object({
  price: TickPrice,
  qty: Count,
  orders: Count,
});
export type DepthLevel = z.infer<typeof DepthLevel>;

/** Top-5 market depth: bids best (highest) first, asks best (lowest) first. */
export const Depth = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  bids: z.array(DepthLevel).length(DEPTH_LEVELS),
  asks: z.array(DepthLevel).length(DEPTH_LEVELS),
  totalBidQty: Count,
  totalAskQty: Count,
  ts: IsoUtc,
});
export type Depth = z.infer<typeof Depth>;

/** An index card: value in hundredths of a point (same integer scale as paise), plus a sparkline. */
export const IndexSummary = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  name: z.string().min(1).max(60),
  exchange: Exchange,
  value: NonNegativePaise,
  change: Paise,
  changeBp: BasisPoints,
  /** Intraday closes, oldest first, same scale as `value`. */
  sparkline: z.array(NonNegativePaise).max(400),
  ts: IsoUtc,
});
export type IndexSummary = z.infer<typeof IndexSummary>;

export const IndicesResponse = z.object({ items: z.array(IndexSummary) });
export type IndicesResponse = z.infer<typeof IndicesResponse>;

/** A compact row used by curated lists and movers. */
export const QuoteRow = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  name: z.string().min(1).max(120),
  ltp: NonNegativePaise,
  change: Paise,
  changeBp: BasisPoints,
});
export type QuoteRow = z.infer<typeof QuoteRow>;

/** Curated list slug, e.g. `market-giants`, `best-returns`, `highest-dividends`, `top-it`. */
export const StockListId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type StockListId = z.infer<typeof StockListId>;

export const StockList = z.object({
  id: StockListId,
  title: z.string().min(1).max(60),
  description: z.string().max(200).nullable(),
  items: z.array(QuoteRow).max(50),
});
export type StockList = z.infer<typeof StockList>;

export const StockListsResponse = z.object({ items: z.array(StockList) });
export type StockListsResponse = z.infer<typeof StockListsResponse>;

export const MoverDirection = z.enum(['gainers', 'losers']);
export type MoverDirection = z.infer<typeof MoverDirection>;

export const MoversQuery = z.object({
  /** Index symbol whose constituents are ranked, e.g. `NIFTY50`. */
  index: TradingSymbol,
  direction: MoverDirection,
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type MoversQuery = z.infer<typeof MoversQuery>;

export const Movers = z.object({
  index: TradingSymbol,
  direction: MoverDirection,
  items: z.array(QuoteRow),
  asOf: IsoUtc,
});
export type Movers = z.infer<typeof Movers>;

/** `?exchange=BSE` on per-instrument routes; NSE when omitted. */
export const ExchangeQuery = z.object({ exchange: Exchange.optional() });
export type ExchangeQuery = z.infer<typeof ExchangeQuery>;

export const SymbolParams = z.object({ symbol: TradingSymbol });
export type SymbolParams = z.infer<typeof SymbolParams>;

export const StockListParams = z.object({ id: StockListId });
export type StockListParams = z.infer<typeof StockListParams>;
