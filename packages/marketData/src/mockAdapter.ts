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
  QuoteRow,
  SearchHit,
  StockList,
} from '@nthstock/contracts';
import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import {
  getMarketStatus,
  istDateKey,
  nseHolidays2026,
  systemClock,
  type Clock,
  type HolidayTable,
} from '@nthstock/utils';
import type { MarketDataAdapter, QuoteListener, Unsubscribe } from './adapter.js';
import { RANGE_YEARS, generateCandles, latestSessionOpen } from './candles.js';
import { generateDepth } from './depth.js';
import { aggregateValue, computeIndexLevel } from './indexLevels.js';
import {
  MOVERS_LIMIT_DEFAULT,
  STOCK_LIST_DEFS,
  buildStockList,
  rankMovers,
  type LiveEquity,
} from './lists.js';
import { changeBasisPoints, circuitBand, clamp, roundToTick } from './price.js';
import { hashSeed, mulberry32, randomNormal, type Rng } from './prng.js';
import { SearchIndex } from './search.js';
import { SECTOR_GBM, type GbmParams } from './sectors.js';
import {
  generateSymbolMaster,
  type MasterEquity,
  type MasterIndex,
  type SymbolMaster,
} from './symbolMaster.js';
import {
  SESSION_MINUTES,
  TRADING_DAYS_PER_YEAR,
  applyTick,
  createPriceState,
  rollSession,
  tickYears,
  type PriceState,
} from './ticks.js';

/** Timer functions, injectable so tests can drive ticks with fake timers or by hand. */
export type Scheduler = {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

type TimerGlobals = {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

/** Looks timers up on each call, so `vi.useFakeTimers()` after construction still takes effect. */
export const globalScheduler: Scheduler = {
  setInterval: (callback, ms) => (globalThis as unknown as TimerGlobals).setInterval(callback, ms),
  clearInterval: (handle) => {
    (globalThis as unknown as TimerGlobals).clearInterval(handle);
  },
};

export type MockMarketDataAdapterOptions = {
  /** Seed for everything random. Same seed + same clock → same data. */
  seed?: number;
  /** A prebuilt master (for sharing one across adapters); otherwise generated from `seed`. */
  master?: SymbolMaster;
  clock?: Clock;
  holidays?: HolidayTable;
  /**
   * Tick even when NSE is closed. Callers wire this to `MOCK_MARKET_ALWAYS_OPEN` (api) or
   * `VITE_MOCK_MARKET_OPEN` (web) for demos; this package never reads the environment itself.
   */
  alwaysOpen?: boolean;
  /** Milliseconds between ticks while someone is subscribed. Default 1,000. */
  tickIntervalMs?: number;
  scheduler?: Scheduler;
};

/** Volatility used for index candles (constituents are diversified). */
const INDEX_VOLATILITY = 0.15;
const INDEX_DRIFT = 0.11;
/** Rough share of a company's shares traded per session. */
const DAILY_TURNOVER = 0.004;
/** Minimum session fraction simulated at start-up, so an early open still shows an opening gap. */
const MIN_ELAPSED_FRACTION = 0.15;
const SPARKLINE_STEP = 5;

type EquityEntry = { kind: 'equity'; master: MasterEquity; state: PriceState; gbm: GbmParams };
type IndexEntry = {
  kind: 'index';
  master: MasterIndex;
  state: PriceState;
  members: EquityEntry[];
  baseLevel: number;
  baseValue: number;
};
type Entry = EquityEntry | IndexEntry;

type Subscription = { symbols: ReadonlySet<string>; listener: QuoteListener };

/**
 * The mock market: seeded symbol master, GBM ticks, index levels, candles, depth, curated lists,
 * movers and search, all in memory and isomorphic. Ticks run only while NSE is open (per the
 * injected clock and holiday table) unless `alwaysOpen` is set, and only while someone is subscribed.
 */
export class MockMarketDataAdapter implements MarketDataAdapter {
  readonly master: SymbolMaster;
  private readonly seed: number;
  private readonly clock: Clock;
  private readonly holidays: HolidayTable;
  private readonly alwaysOpen: boolean;
  private readonly tickIntervalMs: number;
  private readonly scheduler: Scheduler;
  private readonly rng: Rng;
  private readonly entries = new Map<string, Entry>();
  private readonly equityEntries: EquityEntry[] = [];
  private readonly indexEntries: IndexEntry[] = [];
  private readonly instruments: Instrument[];
  private readonly searchIndex: SearchIndex;
  private readonly subscriptions = new Set<Subscription>();
  private sessionKey: string;
  private timer: unknown = null;
  private disposed = false;

  constructor(options: MockMarketDataAdapterOptions = {}) {
    this.master =
      options.master ??
      generateSymbolMaster(options.seed === undefined ? {} : { seed: options.seed });
    this.seed = this.master.seed;
    this.clock = options.clock ?? systemClock;
    this.holidays = options.holidays ?? nseHolidays2026;
    this.alwaysOpen = options.alwaysOpen ?? false;
    this.tickIntervalMs = options.tickIntervalMs ?? 1000;
    this.scheduler = options.scheduler ?? globalScheduler;

    const now = this.clock.now();
    const open = this.isOpen();
    // The session the starting prices belong to: today when ticking, else the last one that ran.
    this.sessionKey = open ? istDateKey(now) : istDateKey(latestSessionOpen(now, this.holidays));
    this.rng = mulberry32(hashSeed(this.seed, 'ticks', this.sessionKey));
    const elapsed = open ? this.elapsedFraction(now) : 1;

    for (const master of this.master.equities) {
      const gbm = this.gbmFor(master);
      const entry: EquityEntry = {
        kind: 'equity',
        master,
        gbm,
        state: this.startingState(master, gbm, elapsed),
      };
      this.entries.set(master.instrument.symbol, entry);
      this.equityEntries.push(entry);
    }
    for (const master of this.master.indices) {
      const members = master.constituents
        .map((symbol) => this.entries.get(symbol))
        .filter((e): e is EquityEntry => e?.kind === 'equity');
      const baseValue = aggregateValue(
        members.map((m) => ({ weight: m.master.sharesOutstanding, price: m.state.prevClose })),
      );
      const entry: IndexEntry = {
        kind: 'index',
        master,
        members,
        baseLevel: master.baseLevel,
        baseValue,
        state: createPriceState(master.baseLevel),
      };
      const openLevel = this.levelAt(entry, (s) => s.open);
      Object.assign(entry.state, { open: openLevel, high: openLevel, low: openLevel });
      this.refreshIndex(entry);
      this.entries.set(master.instrument.symbol, entry);
      this.indexEntries.push(entry);
    }

    this.instruments = [
      ...this.master.indices.map((ix) => ix.instrument),
      ...this.master.equities.map((e) => e.instrument),
    ];
    this.searchIndex = new SearchIndex(this.instruments);
  }

  // ---- MarketDataAdapter -------------------------------------------------------------------

  listInstruments(): Promise<Instrument[]> {
    return Promise.resolve([...this.instruments]);
  }

  getInstrument(symbol: string, exchange?: Exchange): Promise<Instrument | null> {
    return Promise.resolve(this.resolve(symbol, exchange)?.master.instrument ?? null);
  }

  search(query: string, limit?: number): Promise<SearchHit[]> {
    return Promise.resolve(this.searchIndex.search(query, limit));
  }

  getQuote(symbol: string, exchange?: Exchange): Promise<Quote | null> {
    const entry = this.resolve(symbol, exchange);
    return Promise.resolve(entry ? this.quoteOf(entry) : null);
  }

  getQuotes(symbols: readonly string[], exchange?: Exchange): Promise<Quote[]> {
    const quotes: Quote[] = [];
    for (const symbol of symbols) {
      const entry = this.resolve(symbol, exchange);
      if (entry) quotes.push(this.quoteOf(entry));
    }
    return Promise.resolve(quotes);
  }

  getCandles(
    symbol: string,
    range: CandleRange,
    exchange?: Exchange,
  ): Promise<CandleSeries | null> {
    const entry = this.resolve(symbol, exchange);
    if (!entry) return Promise.resolve(null);
    const { interval, candles } = this.candlesOf(entry, range);
    const { instrument } = entry.master;
    return Promise.resolve({
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      range,
      interval,
      candles,
    });
  }

  getDepth(symbol: string, exchange?: Exchange): Promise<Depth | null> {
    const entry = this.resolve(symbol, exchange);
    if (entry?.kind !== 'equity') return Promise.resolve(null);
    const { instrument, sharesOutstanding } = entry.master;
    const { ltp, volume } = entry.state;
    const rng = mulberry32(hashSeed(this.seed, 'depth', instrument.symbol, ltp, volume));
    const avgQty = clamp((sharesOutstanding * DAILY_TURNOVER) / 2_000, 5, 5_000);
    return Promise.resolve({
      token: instrument.token,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      ...generateDepth(ltp, rng, avgQty),
      ts: this.nowIso(),
    });
  }

  getStats(symbol: string, exchange?: Exchange): Promise<InstrumentStats | null> {
    const entry = this.resolve(symbol, exchange);
    if (entry?.kind !== 'equity') return Promise.resolve(null);
    const { master, state } = entry;
    const year = this.candlesOf(entry, '1Y').candles;
    const band = circuitBand(state.prevClose);
    return Promise.resolve({
      token: master.instrument.token,
      symbol: master.instrument.symbol,
      exchange: master.instrument.exchange,
      open: state.open,
      high: state.high,
      low: state.low,
      prevClose: state.prevClose,
      volume: state.volume,
      week52High: Math.max(state.high, ...year.map((c) => c.h)),
      week52Low: Math.min(state.low, ...year.map((c) => c.l)),
      upperCircuit: band.upper,
      lowerCircuit: band.lower,
      marketCap: state.ltp * master.sharesOutstanding,
      peX100:
        master.peX100 === null ? null : Math.round((master.peX100 * state.ltp) / master.basePrice),
      dividendYieldBp: Math.round((master.dividendYieldBp * master.basePrice) / state.ltp),
      asOf: this.nowIso(),
    });
  }

  getIndices(): Promise<IndexSummary[]> {
    return Promise.resolve(
      this.indexEntries.map((entry) => {
        const { instrument } = entry.master;
        const closes = this.candlesOf(entry, '1D').candles.map((c) => c.c);
        const sparkline = closes.filter(
          (_, i) => i % SPARKLINE_STEP === 0 || i === closes.length - 1,
        );
        return {
          token: instrument.token,
          symbol: instrument.symbol,
          name: instrument.name,
          exchange: instrument.exchange,
          value: entry.state.ltp,
          change: entry.state.ltp - entry.state.prevClose,
          changeBp: changeBasisPoints(entry.state.ltp, entry.state.prevClose),
          sparkline,
          ts: this.nowIso(),
        };
      }),
    );
  }

  getStockLists(): Promise<StockList[]> {
    const live = this.liveEquities();
    return Promise.resolve(STOCK_LIST_DEFS.map((def) => buildStockList(def, live)));
  }

  getStockList(id: string): Promise<StockList | null> {
    const def = STOCK_LIST_DEFS.find((d) => d.id === id);
    return Promise.resolve(def ? buildStockList(def, this.liveEquities()) : null);
  }

  getMovers(
    index: string,
    direction: MoverDirection,
    limit: number = MOVERS_LIMIT_DEFAULT,
  ): Promise<Movers | null> {
    const entry = this.entries.get(index);
    if (entry?.kind !== 'index') return Promise.resolve(null);
    return Promise.resolve({
      index: entry.master.instrument.symbol,
      direction,
      items: rankMovers(
        entry.members.map((m) => this.rowOf(m)),
        direction,
        limit,
      ),
      asOf: this.nowIso(),
    });
  }

  subscribe(symbols: readonly string[], listener: QuoteListener, exchange?: Exchange): Unsubscribe {
    if (this.disposed) return () => undefined;
    const known = new Set<string>();
    for (const symbol of symbols) {
      const entry = this.resolve(symbol, exchange);
      if (entry) known.add(entry.master.instrument.symbol);
    }
    const subscription: Subscription = { symbols: known, listener };
    this.subscriptions.add(subscription);
    this.startTimer();
    return () => {
      this.subscriptions.delete(subscription);
      if (this.subscriptions.size === 0) this.stopTimer();
    };
  }

  dispose(): void {
    this.disposed = true;
    this.subscriptions.clear();
    this.stopTimer();
  }

  // ---- Simulation --------------------------------------------------------------------------

  /** True when ticks should run now: NSE open per the clock and holidays, or `alwaysOpen`. */
  isOpen(): boolean {
    return this.alwaysOpen || getMarketStatus(this.clock, this.holidays).state === 'open';
  }

  /**
   * Advances every instrument one tick and notifies subscribers. Does nothing (and returns false)
   * while the market is closed. The timer calls this; tests and MSW handlers may call it directly.
   */
  tick(): boolean {
    if (this.disposed || !this.isOpen()) return false;
    const key = istDateKey(this.clock.now());
    if (key !== this.sessionKey) this.rollSession(key);

    const dtYears = tickYears(this.tickIntervalMs);
    const ticksPerSession = (SESSION_MINUTES * 60_000) / this.tickIntervalMs;
    for (const entry of this.equityEntries) {
      applyTick(entry.state, {
        params: entry.gbm,
        dtYears,
        rng: this.rng,
        volumePerTick: (entry.master.sharesOutstanding * DAILY_TURNOVER) / ticksPerSession,
      });
    }
    for (const entry of this.indexEntries) this.refreshIndex(entry);

    for (const { symbols, listener } of [...this.subscriptions]) {
      if (symbols.size === 0) continue;
      const quotes: Quote[] = [];
      for (const symbol of symbols) {
        const entry = this.entries.get(symbol);
        if (entry) quotes.push(this.quoteOf(entry));
      }
      listener(quotes);
    }
    return true;
  }

  private startTimer(): void {
    if (this.timer !== null || this.disposed) return;
    this.timer = this.scheduler.setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.scheduler.clearInterval(this.timer);
    this.timer = null;
  }

  private rollSession(key: string): void {
    this.sessionKey = key;
    for (const entry of this.equityEntries) rollSession(entry.state);
    for (const entry of this.indexEntries) {
      rollSession(entry.state);
      entry.baseLevel = entry.state.ltp;
      entry.baseValue = aggregateValue(
        entry.members.map((m) => ({
          weight: m.master.sharesOutstanding,
          price: m.state.prevClose,
        })),
      );
    }
  }

  private gbmFor(master: MasterEquity): GbmParams {
    const params = SECTOR_GBM[master.sector];
    const scale = master.capBucket === 'SMALL' ? 1.4 : master.capBucket === 'MID' ? 1.2 : 1;
    return { drift: params.drift, volatility: params.volatility * scale };
  }

  /** Session fraction elapsed at `now` (0 at 9:15, 1 at 15:30), at least MIN_ELAPSED_FRACTION. */
  private elapsedFraction(now: Date): number {
    const open = latestSessionOpen(now, this.holidays);
    const fraction = (now.getTime() - open.getTime()) / (SESSION_MINUTES * 60_000);
    return clamp(fraction, MIN_ELAPSED_FRACTION, 1);
  }

  /** Opening gap plus the session so far, so quotes, lists and movers aren't flat at start-up. */
  private startingState(master: MasterEquity, gbm: GbmParams, elapsed: number): PriceState {
    const prevClose = master.basePrice;
    const band = circuitBand(prevClose);
    const rng = mulberry32(
      hashSeed(this.seed, 'session', this.sessionKey, master.instrument.symbol),
    );
    const daySigma = gbm.volatility / Math.sqrt(TRADING_DAYS_PER_YEAR);
    const onTick = (value: number) => clamp(roundToTick(value), band.lower, band.upper);

    const open = onTick(prevClose * Math.exp(daySigma * 0.3 * randomNormal(rng)));
    const ltp = onTick(open * Math.exp(daySigma * Math.sqrt(elapsed) * randomNormal(rng)));
    const reach = () => 1 + Math.abs(randomNormal(rng)) * daySigma * 0.3 * Math.sqrt(elapsed);
    const state = createPriceState(prevClose, open);
    state.ltp = ltp;
    state.raw = ltp;
    state.high = onTick(Math.max(open, ltp) * reach());
    state.low = onTick(Math.min(open, ltp) / reach());
    state.volume = Math.round(master.sharesOutstanding * DAILY_TURNOVER * elapsed * (0.5 + rng()));
    return state;
  }

  private levelAt(entry: IndexEntry, price: (s: PriceState) => number): number {
    return computeIndexLevel(
      entry.baseLevel,
      entry.baseValue,
      entry.members.map((m) => ({ weight: m.master.sharesOutstanding, price: price(m.state) })),
    );
  }

  private refreshIndex(entry: IndexEntry): void {
    const level = this.levelAt(entry, (s) => s.ltp);
    entry.state.ltp = level;
    entry.state.raw = level;
    if (level > entry.state.high) entry.state.high = level;
    if (level < entry.state.low) entry.state.low = level;
  }

  private resolve(symbol: string, exchange?: Exchange): Entry | undefined {
    const entry = this.entries.get(symbol);
    if (!entry) return undefined;
    if (exchange !== undefined && entry.master.instrument.exchange !== exchange) return undefined;
    return entry;
  }

  private quoteOf(entry: Entry): Quote {
    const { instrument } = entry.master;
    const { state } = entry;
    return {
      token: instrument.token,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      ltp: state.ltp,
      change: state.ltp - state.prevClose,
      changeBp: changeBasisPoints(state.ltp, state.prevClose),
      open: state.open,
      high: state.high,
      low: state.low,
      prevClose: state.prevClose,
      volume: state.volume,
      ts: this.nowIso(),
    };
  }

  private rowOf(entry: EquityEntry): QuoteRow {
    const { instrument } = entry.master;
    const { state } = entry;
    return {
      token: instrument.token,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      name: instrument.name,
      ltp: state.ltp,
      change: state.ltp - state.prevClose,
      changeBp: changeBasisPoints(state.ltp, state.prevClose),
    };
  }

  private liveEquities(): LiveEquity[] {
    return this.equityEntries.map((entry) => ({
      equity: entry.master,
      row: this.rowOf(entry),
      marketCap: entry.state.ltp * entry.master.sharesOutstanding,
    }));
  }

  private candlesOf(entry: Entry, range: CandleRange) {
    const { symbol } = entry.master.instrument;
    const { state } = entry;
    const isIndex = entry.kind === 'index';
    const volatility = isIndex ? INDEX_VOLATILITY : entry.gbm.volatility;
    const drift = isIndex ? INDEX_DRIFT : entry.gbm.drift;
    const anchorKey = istDateKey(latestSessionOpen(this.clock.now(), this.holidays));
    const seed = hashSeed(this.seed, 'candles', symbol, range, anchorKey);
    const years = RANGE_YEARS[range];

    // Where the chart starts: today's open for 1D, a seeded earlier price otherwise.
    const rng = mulberry32(hashSeed(seed, 'start'));
    let startPrice: number;
    if (range === '1D') {
      startPrice = state.open;
    } else if (range === '1Y' && !isIndex) {
      startPrice = state.ltp / (1 + entry.master.return1yBp / 10_000);
    } else {
      const logMove = (drift - (volatility * volatility) / 2) * years;
      startPrice =
        state.ltp / Math.exp(logMove + volatility * Math.sqrt(years) * randomNormal(rng));
    }
    return generateCandles({
      range,
      clock: this.clock,
      endPrice: state.ltp,
      startPrice,
      volatility,
      seed,
      sessionVolume: isIndex ? 0 : entry.master.sharesOutstanding * DAILY_TURNOVER,
      holidays: this.holidays,
      tick: isIndex ? 1 : TICK_SIZE_PAISE,
    });
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }
}
