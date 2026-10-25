import type {
  CandleInterval,
  CandleRange,
  CandleSeries,
  Depth,
  Exchange,
  IndexSummary,
  IndexRef,
  Instrument,
  InstrumentProfile,
  InstrumentStats,
  MoverDirection,
  Movers,
  Quote,
  QuoteRow,
  SearchHit,
  StockList,
} from '@nthstock/contracts';
import {
  POPULAR_SEARCHES_LIMIT_DEFAULT,
  POPULAR_SEARCHES_LIMIT_MAX,
  TICK_SIZE_PAISE,
} from '@nthstock/contracts';
import {
  getMarketStatus,
  istDateKey,
  nseHolidays2026,
  systemClock,
  type Clock,
  type HolidayTable,
} from '@nthstock/utils';
import type { MarketDataAdapter, QuoteListener, Unsubscribe } from './adapter.js';
import {
  CANDLE_SPECS,
  RANGE_YEARS,
  generateCandles,
  latestSessionOpen,
  resampleCandles,
} from './candles.js';
import { generateDepth } from './depth.js';
import { MinuteBars, mergeMinuteBars } from './minuteBars.js';
import { aggregateValue, computeIndexLevel } from './indexLevels.js';
import {
  MOVERS_LIMIT_DEFAULT,
  STOCK_LIST_DEFS,
  buildStockList,
  rankMovers,
  type LiveEquity,
} from './lists.js';
import { profileAbout } from './profile.js';
import { changeBasisPoints, circuitBand, clamp, roundToTick } from './price.js';
import { hashSeed, mulberry32, randomNormal, type Rng } from './prng.js';
import { SearchIndex, toSearchHit } from './search.js';
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
  /** Milliseconds between ticks of the focused instrument (SPEC-TFC-1 TFC-11). Default 250. */
  focusIntervalMs?: number;
  /** The longest gap replayed tick by tick (SPEC-TFC-1 §6.7). Default 30 minutes. */
  replayLimitMs?: number;
  scheduler?: Scheduler;
  /**
   * Prices come from outside (spec market-data-and-matching §4, NSTOCK-0354): the adapter never
   * runs its own random walk and moves only on `applyQuotes`, so every apps/api instance follows
   * the one quote service. Lists, movers, candles and subscribers all see those prices.
   */
  externalTicks?: boolean;
};

/** Ticks a `nudge` spreads its move over. */
export const NUDGE_TICKS = 4;
const DEFAULT_FOCUS_INTERVAL_MS = 250;
const DEFAULT_REPLAY_LIMIT_MS = 30 * 60_000;

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

/** A nudge still being applied: the per-tick factor and the ticks left. */
type Nudge = { factor: number; left: number };

/** Quotes stepped in one `advance`, by tick time (epoch ms), then by symbol. */
type TickEvents = Map<number, Map<string, Quote>>;

/**
 * The mock market: seeded symbol master, GBM ticks, index levels, candles, depth, curated lists,
 * movers and search, all in memory and isomorphic. Ticks run only while NSE is open (per the
 * injected clock and holiday table) unless `alwaysOpen` is set, and only while someone is subscribed.
 *
 * The simulated feed (SPEC-TFC-1 §6.7, TFC-11, PLAN-TFC-1 T07):
 * - Every instrument has its own seeded random stream, so one can advance without the others.
 * - The focused instrument (`focus`) ticks every 250 ms, the rest every second.
 * - When the timer fires more than two intervals late (a phone paused the tab), the instruments in
 *   `setReplaySymbols` (working orders, active stops) replay every missed tick, in order and with
 *   its timestamp, up to 30 minutes; every other instrument, and a longer gap, moves in one exact
 *   step.
 * - Ticks build 1-minute bars that replace the generated ones in the 1D candles.
 * - `nudge` and `gap` move one instrument's real feed for the demo Simulator, so every screen agrees.
 */
export class MockMarketDataAdapter implements MarketDataAdapter {
  readonly master: SymbolMaster;
  private readonly seed: number;
  private readonly clock: Clock;
  private readonly holidays: HolidayTable;
  private readonly alwaysOpen: boolean;
  private readonly tickIntervalMs: number;
  private readonly focusIntervalMs: number;
  private readonly replayLimitMs: number;
  private readonly scheduler: Scheduler;
  private readonly externalTicks: boolean;
  /** Each instrument's own random stream for this session, created on its first tick. */
  private readonly rngs = new Map<string, Rng>();
  private readonly entries = new Map<string, Entry>();
  private readonly equityEntries: EquityEntry[] = [];
  private readonly indexEntries: IndexEntry[] = [];
  private readonly instruments: Instrument[];
  private readonly searchIndex: SearchIndex;
  /** Indices each equity is a constituent of, in index-definition order. */
  private readonly membership = new Map<string, IndexRef[]>();
  private readonly subscriptions = new Set<Subscription>();
  private readonly bars = new Map<string, MinuteBars>();
  private readonly nudges = new Map<string, Nudge>();
  private readonly replaySymbols = new Set<string>();
  private focused: string | null = null;
  /** When each lane last ticked (epoch ms). */
  private lastSlowAt: number;
  private lastFastAt: number;
  /** Fast-lane ticks since the slow lane last ran, so a clock that stands still still ticks it. */
  private fastSinceSlow = 0;
  private sessionKey: string;
  private timer: unknown = null;
  private timerMs = 0;
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
    this.focusIntervalMs = options.focusIntervalMs ?? DEFAULT_FOCUS_INTERVAL_MS;
    this.replayLimitMs = options.replayLimitMs ?? DEFAULT_REPLAY_LIMIT_MS;
    this.scheduler = options.scheduler ?? globalScheduler;
    this.externalTicks = options.externalTicks ?? false;

    const now = this.clock.now();
    this.lastSlowAt = now.getTime();
    this.lastFastAt = now.getTime();
    const open = this.isOpen();
    // The session the starting prices belong to: today when ticking, else the last one that ran.
    this.sessionKey = open ? istDateKey(now) : istDateKey(latestSessionOpen(now, this.holidays));
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
      const ref = { symbol: master.instrument.symbol, name: master.instrument.name };
      for (const member of members) {
        const symbol = member.master.instrument.symbol;
        this.membership.set(symbol, [...(this.membership.get(symbol) ?? []), ref]);
      }
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

  getPopularSearches(limit: number = POPULAR_SEARCHES_LIMIT_DEFAULT): Promise<SearchHit[]> {
    const max = clamp(Math.floor(limit), 1, POPULAR_SEARCHES_LIMIT_MAX);
    const ranked = [...this.equityEntries].sort(
      (a, b) => b.state.volume - a.state.volume || a.master.rank - b.master.rank,
    );
    return Promise.resolve(ranked.slice(0, max).map((e) => toSearchHit(e.master.instrument)));
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
    interval?: CandleInterval,
  ): Promise<CandleSeries | null> {
    const entry = this.resolve(symbol, exchange);
    if (!entry) return Promise.resolve(null);
    const own = this.candlesOf(entry, range);
    // A longer bar is built from the range's own bars, the live ones included (NSTOCK-0343).
    const wanted = interval ?? own.interval;
    const candles = wanted === own.interval ? own.candles : resampleCandles(own.candles, wanted);
    const { instrument } = entry.master;
    return Promise.resolve({
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      range,
      interval: wanted,
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

  getProfile(symbol: string, exchange?: Exchange): Promise<InstrumentProfile | null> {
    const entry = this.resolve(symbol, exchange);
    if (entry?.kind !== 'equity') return Promise.resolve(null);
    const { instrument, sector, capBucket } = entry.master;
    const indices = this.membership.get(instrument.symbol) ?? [];
    return Promise.resolve({
      token: instrument.token,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      name: instrument.name,
      sector,
      capCategory: capBucket,
      about: profileAbout({
        name: instrument.name,
        sector,
        capCategory: capBucket,
        exchange: instrument.exchange,
        indices,
      }),
      indices: [...indices],
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
   * while the market is closed. Tests and MSW handlers call it directly; the timer runs `advance`.
   */
  tick(): boolean {
    if (!this.prepareTick()) return false;
    const now = this.clock.now().getTime();
    const wanted = this.wantedSymbols();
    const events: TickEvents = new Map();
    for (const entry of this.equityEntries) {
      this.step(entry, this.tickIntervalMs, now, 1, wanted, events);
    }
    this.lastSlowAt = Math.max(this.lastSlowAt, now);
    this.lastFastAt = Math.max(this.lastFastAt, now);
    this.finishTick(now, wanted, events);
    return true;
  }

  /**
   * One timer beat, by the clock (SPEC-TFC-1 §6.7): the focused instrument's lane every beat, the
   * other instruments once a second. A lane that is more than two intervals late catches up:
   * instruments in `setReplaySymbols` replay each missed tick with its own timestamp (up to the
   * replay limit), the rest move in one exact step. Subscribers get the ticks in time order.
   * Returns false while the market is closed.
   */
  advance(): boolean {
    if (!this.prepareTick()) return false;
    const now = this.clock.now().getTime();
    const wanted = this.wantedSymbols();
    const events: TickEvents = new Map();
    const focused = this.focused === null ? undefined : this.entries.get(this.focused);

    let slowDue = true;
    if (focused?.kind === 'equity') {
      this.runLane([focused], this.focusIntervalMs, this.lastFastAt, now, wanted, events);
      this.lastFastAt = now;
      this.fastSinceSlow += 1;
      slowDue =
        now - this.lastSlowAt >= this.tickIntervalMs ||
        this.fastSinceSlow * this.focusIntervalMs >= this.tickIntervalMs;
    }
    if (slowDue) {
      const rest = this.equityEntries.filter((entry) => entry !== focused);
      this.runLane(rest, this.tickIntervalMs, this.lastSlowAt, now, wanted, events);
      this.lastSlowAt = now;
      this.fastSinceSlow = 0;
    }
    this.finishTick(now, wanted, events);
    return true;
  }

  /**
   * Ticks `symbol` every 250 ms instead of every second (SPEC-TFC-1 TFC-11): the instrument on the
   * user's screen. `null` puts every instrument back on the one-second lane.
   */
  focus(symbol: string | null): void {
    const entry = symbol === null ? undefined : this.entries.get(symbol);
    const next = entry?.kind === 'equity' ? entry.master.instrument.symbol : null;
    if (next === this.focused) return;
    this.focused = next;
    this.lastFastAt = this.clock.now().getTime();
    this.fastSinceSlow = 0;
    this.restartTimer();
  }

  /** The focused instrument, or null. */
  focusedSymbol(): string | null {
    return this.focused;
  }

  /**
   * The instruments whose missed ticks are replayed one by one after a late timer: those with a
   * working order or an active trailing stop (SPEC-TFC-1 §6.7). Replaces the previous set.
   */
  setReplaySymbols(symbols: Iterable<string>): void {
    this.replaySymbols.clear();
    for (const symbol of symbols) {
      if (this.entries.get(symbol)?.kind === 'equity') this.replaySymbols.add(symbol);
    }
  }

  /**
   * Moves `symbol` by `ratio` (0.01 is +1%) over its next `NUDGE_TICKS` ticks, on top of its random
   * walk: the demo Simulator's Rally and Pull back. False for an unknown symbol or an index.
   */
  nudge(symbol: string, ratio: number): boolean {
    const entry = this.entries.get(symbol);
    if (entry?.kind !== 'equity') return false;
    assertRatio(ratio);
    this.nudges.set(symbol, { factor: Math.pow(1 + ratio, 1 / NUDGE_TICKS), left: NUDGE_TICKS });
    return true;
  }

  /**
   * Moves `symbol` by `ratio` (−0.03 is −3%) at once, as one tick that subscribers receive now:
   * the demo Simulator's Gap. Held inside the circuit band. Returns the new quote, or null for an
   * unknown symbol, an index, or a closed market.
   */
  gap(symbol: string, ratio: number): Quote | null {
    const entry = this.entries.get(symbol);
    if (entry?.kind !== 'equity') return null;
    assertRatio(ratio);
    if (!this.prepareTick()) return null;
    const now = this.clock.now().getTime();
    movePrice(entry.state, 1 + ratio);
    this.bars.get(symbol)?.record(now, entry.state.ltp);
    const events: TickEvents = new Map([[now, new Map([[symbol, this.quoteOf(entry, now)]])]]);
    this.finishTick(now, this.wantedSymbols(), events);
    return this.quoteOf(entry, now);
  }

  /**
   * Takes quotes from an outside feed (the `externalTicks` mode): each known instrument jumps to
   * its quote, its minute bar records the move, and subscribers get the quotes, one batch per tick
   * time. Quotes for unknown instruments are ignored. Unlike `tick`, it does not check the market
   * hours: the feed decides when the market trades.
   */
  applyQuotes(quotes: readonly Quote[]): void {
    if (this.disposed || quotes.length === 0) return;
    const key = istDateKey(this.clock.now());
    if (key !== this.sessionKey) this.rollSession(key);
    const wanted = this.wantedSymbols();
    const events: TickEvents = new Map();
    for (const quote of quotes) {
      const entry = this.resolve(quote.symbol, quote.exchange);
      if (!entry || entry.master.instrument.token !== quote.token) continue;
      const at = Date.parse(quote.ts);
      const volumeBefore = entry.state.volume;
      Object.assign(entry.state, {
        prevClose: quote.prevClose,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        ltp: quote.ltp,
        raw: quote.ltp,
        volume: quote.volume,
      });
      const { symbol } = entry.master.instrument;
      if (!wanted.has(symbol) && !this.replaySymbols.has(symbol)) continue;
      this.barsOf(symbol).record(at, quote.ltp, Math.max(0, quote.volume - volumeBefore));
      if (!wanted.has(symbol)) continue;
      let batch = events.get(at);
      if (!batch) {
        batch = new Map();
        events.set(at, batch);
      }
      batch.set(symbol, this.quoteOf(entry, at));
    }
    this.dispatch(events);
  }

  /** False while closed or disposed; otherwise rolls into a new session when the day changed. */
  private prepareTick(): boolean {
    if (this.disposed || !this.isOpen()) return false;
    const key = istDateKey(this.clock.now());
    if (key !== this.sessionKey) this.rollSession(key);
    return true;
  }

  /**
   * Ticks `lane` from `last` to `now` at `intervalMs`: one tick when the timer is up to two
   * intervals late, and past that each missed tick for the replay set, one exact step for the rest.
   */
  private runLane(
    lane: readonly EquityEntry[],
    intervalMs: number,
    last: number,
    now: number,
    wanted: ReadonlySet<string>,
    events: TickEvents,
  ): void {
    const elapsed = now - last;
    const missed = elapsed > 2 * intervalMs ? Math.floor(elapsed / intervalMs) : 1;
    for (const entry of lane) {
      const replay =
        this.replaySymbols.has(entry.master.instrument.symbol) &&
        missed * intervalMs <= this.replayLimitMs;
      if (missed === 1) {
        this.step(entry, intervalMs, now, 1, wanted, events);
      } else if (replay) {
        for (let k = 1; k <= missed; k += 1) {
          this.step(entry, intervalMs, last + k * intervalMs, 1, wanted, events);
        }
      } else {
        this.step(entry, intervalMs, now, missed, wanted, events);
      }
    }
  }

  /**
   * Advances one instrument by `ticks` intervals as one GBM step at time `at` (one step of n
   * intervals has exactly the distribution of n steps), applies any nudge, builds its minute bar,
   * and keeps the quote for subscribers.
   */
  private step(
    entry: EquityEntry,
    intervalMs: number,
    at: number,
    ticks: number,
    wanted: ReadonlySet<string>,
    events: TickEvents,
  ): void {
    const { symbol } = entry.master.instrument;
    const nudge = this.nudges.get(symbol);
    if (nudge) {
      const applied = Math.min(nudge.left, ticks);
      movePrice(entry.state, Math.pow(nudge.factor, applied));
      nudge.left -= applied;
      if (nudge.left === 0) this.nudges.delete(symbol);
    }
    const volumeBefore = entry.state.volume;
    const ticksPerSession = (SESSION_MINUTES * 60_000) / intervalMs;
    applyTick(entry.state, {
      params: entry.gbm,
      dtYears: tickYears(intervalMs * ticks),
      rng: this.rngOf(symbol),
      volumePerTick: (ticks * (entry.master.sharesOutstanding * DAILY_TURNOVER)) / ticksPerSession,
    });
    if (!wanted.has(symbol) && !this.replaySymbols.has(symbol)) return;
    this.barsOf(symbol).record(at, entry.state.ltp, entry.state.volume - volumeBefore);
    if (!wanted.has(symbol)) return;
    let batch = events.get(at);
    if (!batch) {
      batch = new Map();
      events.set(at, batch);
    }
    batch.set(symbol, this.quoteOf(entry, at));
  }

  /** Refreshes the indices, then sends each subscriber its quotes, one batch per tick time. */
  private finishTick(now: number, wanted: ReadonlySet<string>, events: TickEvents): void {
    if (events.size === 0 && wanted.size === 0) return;
    for (const entry of this.indexEntries) {
      this.refreshIndex(entry);
      const { symbol } = entry.master.instrument;
      if (!wanted.has(symbol)) continue;
      this.barsOf(symbol).record(now, entry.state.ltp);
      let batch = events.get(now);
      if (!batch) {
        batch = new Map();
        events.set(now, batch);
      }
      batch.set(symbol, this.quoteOf(entry, now));
    }
    this.dispatch(events);
  }

  /** Sends each subscriber its quotes from `events`, one batch per tick time, oldest first. */
  private dispatch(events: TickEvents): void {
    const times = [...events.keys()].sort((a, b) => a - b);
    for (const at of times) {
      const batch = events.get(at) as Map<string, Quote>;
      for (const { symbols, listener } of [...this.subscriptions]) {
        const quotes: Quote[] = [];
        for (const symbol of symbols) {
          const quote = batch.get(symbol);
          if (quote) quotes.push(quote);
        }
        if (quotes.length > 0) listener(quotes);
      }
    }
  }

  /** Every symbol some subscriber listens to. */
  private wantedSymbols(): Set<string> {
    const wanted = new Set<string>();
    for (const { symbols } of this.subscriptions) for (const symbol of symbols) wanted.add(symbol);
    return wanted;
  }

  private rngOf(symbol: string): Rng {
    let rng = this.rngs.get(symbol);
    if (!rng) {
      rng = mulberry32(hashSeed(this.seed, 'ticks', this.sessionKey, symbol));
      this.rngs.set(symbol, rng);
    }
    return rng;
  }

  private barsOf(symbol: string): MinuteBars {
    let bars = this.bars.get(symbol);
    if (!bars) {
      bars = new MinuteBars();
      this.bars.set(symbol, bars);
    }
    return bars;
  }

  private startTimer(): void {
    if (this.timer !== null || this.disposed || this.externalTicks) return;
    // Idle time is not a gap to replay: ticks resume from now.
    const now = this.clock.now().getTime();
    this.lastSlowAt = now;
    this.lastFastAt = now;
    this.fastSinceSlow = 0;
    this.timerMs = this.focused === null ? this.tickIntervalMs : this.focusIntervalMs;
    this.timer = this.scheduler.setInterval(() => {
      this.advance();
    }, this.timerMs);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.scheduler.clearInterval(this.timer);
    this.timer = null;
  }

  /** Moves a running timer to the beat the focus needs, keeping each lane's last tick. */
  private restartTimer(): void {
    if (this.timer === null) return;
    const wantMs = this.focused === null ? this.tickIntervalMs : this.focusIntervalMs;
    if (wantMs === this.timerMs) return;
    this.scheduler.clearInterval(this.timer);
    this.timerMs = wantMs;
    this.timer = this.scheduler.setInterval(() => {
      this.advance();
    }, wantMs);
  }

  private rollSession(key: string): void {
    this.sessionKey = key;
    this.rngs.clear();
    this.bars.clear();
    this.nudges.clear();
    // A new session ticks from now; the closed hours in between are not replayed.
    const now = this.clock.now().getTime();
    this.lastSlowAt = now;
    this.lastFastAt = now;
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

  private quoteOf(entry: Entry, at?: number): Quote {
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
      ts: at === undefined ? this.nowIso() : new Date(at).toISOString(),
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

  /**
   * Candles for a range. The 1D range ends with the bars built from live ticks; the generated
   * part runs up to the first of them and ends at its open, so the series is continuous.
   */
  private candlesOf(entry: Entry, range: CandleRange) {
    const built = range === '1D' ? this.bars.get(entry.master.instrument.symbol) : undefined;
    const first = built?.firstMinute() ?? null;
    if (!built || first === null) return this.generatedCandlesOf(entry, range);
    const builtBars = built.bars();
    const sessionOpen = latestSessionOpen(this.clock.now(), this.holidays).getTime();
    const before =
      first > sessionOpen
        ? this.generatedCandlesOf(entry, range, {
            now: () => new Date(first - 1),
            endPrice: (builtBars[0] as { o: number }).o,
          }).candles
        : [];
    return { interval: CANDLE_SPECS['1D'].interval, candles: mergeMinuteBars(before, builtBars) };
  }

  private generatedCandlesOf(
    entry: Entry,
    range: CandleRange,
    until?: { now: () => Date; endPrice: number },
  ) {
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
      clock: until ? { now: until.now } : this.clock,
      endPrice: until ? until.endPrice : state.ltp,
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

function assertRatio(ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= -1) {
    throw new RangeError(`A price move must be a finite ratio above -1, got ${String(ratio)}`);
  }
}

/** Multiplies the model price by `factor`, inside the circuit band, and updates LTP, high and low. */
function movePrice(state: PriceState, factor: number): void {
  const band = circuitBand(state.prevClose);
  state.raw = clamp(state.raw * factor, band.lower, band.upper);
  state.ltp = clamp(roundToTick(state.raw), band.lower, band.upper);
  if (state.ltp > state.high) state.high = state.ltp;
  if (state.ltp < state.low) state.low = state.ltp;
}
