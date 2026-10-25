import type {
  AccountState,
  Exchange,
  Holding,
  Instrument,
  InstrumentStats,
  InstrumentToken,
  ModifyOrderRequest,
  ModifyTrailingStopRequest,
  Order,
  OrderStatus,
  OrderHistoryResponse,
  OrdersPage,
  PlaceOrderRequest,
  PlaceTrailingStopRequest,
  PortfolioSummary,
  ProductType,
  Position,
  Quote,
  FundsSummary,
  LedgerPage,
  TrailingStop,
  TrailingStopStatus,
} from '@nthstock/contracts';
import { PAGE_LIMIT_DEFAULT } from '@nthstock/contracts';
import {
  fromIst,
  istDateKey,
  nseHolidays2026,
  toIstParts,
  type Clock,
  type HolidayTable,
} from '@nthstock/utils';
import { createEngineContext, type PriceSource } from './context.js';
import type { InstrumentInfo, InstrumentSource } from './instruments.js';
import type { MarketHours } from './orderValidation.js';
import {
  PaperEngine,
  type OrderActionResult,
  type PaperEngineSnapshot,
  type TrailingStopActionResult,
} from './paperEngine.js';
import { averagePrice, basisPoints, holdingValues, positionValues } from './positionMath.js';

/**
 * The slice of a market data adapter the desk reads (`MarketDataAdapter` in packages/marketData
 * fits it). Declared here so this package stays free of the adapter package.
 */
export interface DeskMarket {
  listInstruments(): Promise<readonly Instrument[]>;
  getQuote(symbol: string, exchange?: Exchange): Promise<Quote | null>;
  getStats(
    symbol: string,
    exchange?: Exchange,
  ): Promise<Pick<InstrumentStats, 'lowerCircuit' | 'upperCircuit'> | null>;
  subscribe(
    symbols: readonly string[],
    listener: (quotes: readonly Quote[]) => void,
    exchange?: Exchange,
  ): () => void;
}

/** Where the desk keeps each user's engine. In memory now; the storage seam for later. */
export interface EngineRegistry {
  get(userId: string): PaperEngine | undefined;
  set(userId: string, engine: PaperEngine): void;
  entries(): Iterable<readonly [string, PaperEngine]>;
}

export type PaperDeskOptions = {
  /** Every engine reads time from this clock; tests and scenarios inject one they control. */
  clock: Clock;
  market: DeskMarket;
  /** Ids for orders and ledger entries: unique across users (the backend injects a random one). */
  newId: () => string;
  holidays?: HolidayTable;
  /** Market hours for every engine on the desk; defaults to `nse` (see `PaperEngineOptions`). */
  marketHours?: MarketHours;
  /** Defaults to a Map. */
  engines?: EngineRegistry;
  /** Every order change of every user: the backend turns these into `orderUpdate` frames. */
  onOrderUpdate?: (userId: string, order: Order) => void;
  /** Every trailing-stop change of every user (SPEC-TFC-1 §10.1). */
  onTrailingStopUpdate?: (userId: string, stop: TrailingStop) => void;
  /** False refuses trailing stops. Default true. */
  trailingStops?: boolean;
  /** After any change to a user's engine (MSW saves a snapshot here). */
  onChange?: (userId: string, engine: PaperEngine) => void;
};

/** Order book pages are newest first; the cursor is the id of the last order on a page. */
export type OrdersPageQuery = { status?: OrderStatus; cursor?: string; limit?: number };

/** Ledger pages are newest first; the cursor is the id of the last entry on a page. */
export type LedgerPageQuery = { cursor?: string; limit?: number };

const LIVE: ReadonlySet<OrderStatus> = new Set(['AMO', 'OPEN']);
/** Trailing stops that must step on every tick of their instrument (SPEC-TFC-1 §10.3). */
const STEPPED: ReadonlySet<TrailingStopStatus> = new Set(['ARMED', 'TRAILING', 'TRIGGERED']);

type CachedInstrument = { info: InstrumentInfo | null; day: string };

type CachedClose = { prevClose: number | null; day: string };

/**
 * A tick at most this old runs the engines at its own timestamp: the catch-up replay after a
 * paused tab (SPEC-TFC-1 §6.7), so session events fall between the right ticks. Older ticks (a
 * fixed test quote) run at the clock's time.
 */
const REPLAY_WINDOW_MS = 30 * 60_000;

/**
 * The paper-trading desk: one `PaperEngine` per user, all fed by one market (ADR 0004). Both mock
 * backends run it (apps/api's orders module and the MSW order handlers), so they behave alike.
 *
 * - One engine per user. An engine is one paper account (its own funds ledger, positions and
 *   holdings), so a per-user engine keeps accounts apart by construction: an order id is only
 *   ever looked up in its owner's engine, and one user's work never waits on another's.
 * - Prices: the last tick for each instrument, seeded from the adapter's quote the first time an
 *   order names it, then kept current by an adapter subscription. `pinPrice` overrides the feed
 *   for one instrument (scripted ticks in tests and scenarios).
 * - Ticks: every tick syncs only the engines with a live (AMO or OPEN) order or an active
 *   trailing stop in a ticked instrument, so a limit order fills on the tick that crosses it, a
 *   stop steps even with no working order, and `onOrderUpdate` fires.
 *   `setFillCap` splits LIMIT fills in an instrument over several ticks (the demo Simulator's
 *   "Split large fills", SPEC-TFC-1 TFC-10).
 * - Session events (9:15 AMO release, 15:20 square-off, 15:30 close) run on the next sync of an
 *   engine: every read syncs first, and `sweep()` (a timer in the backend) syncs every engine.
 * - Instruments: names and today's circuit band, from the adapter's instrument list and stats,
 *   cached per IST day.
 */
export class PaperDesk {
  readonly #options: PaperDeskOptions;
  readonly #engines: EngineRegistry;
  readonly #holidays: HolidayTable;
  readonly #ticks = new Map<InstrumentToken, number>();
  readonly #pins = new Map<InstrumentToken, number>();
  /** Ticks seen per instrument, from the feed and from pinned prices. */
  readonly #tickSeq = new Map<InstrumentToken, number>();
  readonly #fillCaps = new Map<InstrumentToken, number>();
  readonly #instruments = new Map<InstrumentToken, CachedInstrument>();
  readonly #subscriptions = new Map<InstrumentToken, () => void>();
  readonly #prevCloses = new Map<InstrumentToken, CachedClose>();
  /** Users with a live order or an active trailing stop in each instrument. */
  readonly #liveUsers = new Map<InstrumentToken, Set<string>>();
  /** The instruments each user has live orders or stops in (the reverse of `#liveUsers`). */
  readonly #liveTokens = new Map<string, Set<InstrumentToken>>();
  readonly #prices: PriceSource;
  readonly #instrumentSource: InstrumentSource;
  #symbolMaster: Promise<Map<InstrumentToken, Instrument>> | null = null;
  #disposed = false;
  /** While a batch of ticks is ingested, the instant they happened; the engines' "now". */
  #tickAt: Date | null = null;
  /** What the engines read as now: the tick being ingested, else the clock. */
  readonly #engineClock: Clock = { now: () => this.#tickAt ?? this.#options.clock.now() };

  constructor(options: PaperDeskOptions) {
    this.#options = options;
    this.#engines = options.engines ?? mapRegistry();
    this.#holidays = options.holidays ?? nseHolidays2026;
    this.#prices = {
      getLtp: (token) => this.#pins.get(token) ?? this.#ticks.get(token) ?? null,
      tickSeq: (token) => this.#tickSeq.get(token) ?? 0,
    };
    this.#instrumentSource = {
      getInstrument: (token) => this.#instruments.get(token)?.info ?? null,
    };
  }

  /** The LTP the engines see for `token` (a pinned price wins over the feed), or null. */
  ltp(token: InstrumentToken): number | null {
    return this.#prices.getLtp(token);
  }

  // ---- Commands ------------------------------------------------------------------------------

  async place(userId: string, request: PlaceOrderRequest): Promise<OrderActionResult> {
    await this.#prepare(request.token);
    return this.#change(userId, (engine) => engine.place(request));
  }

  async modify(
    userId: string,
    id: string,
    request: ModifyOrderRequest,
  ): Promise<OrderActionResult> {
    const token = this.#engines.get(userId)?.getOrder(id)?.token;
    if (token !== undefined) await this.#prepare(token);
    return this.#change(userId, (engine) => engine.modify(id, request));
  }

  async cancel(userId: string, id: string): Promise<OrderActionResult> {
    const token = this.#engines.get(userId)?.getOrder(id)?.token;
    if (token !== undefined) await this.#prepare(token);
    return this.#change(userId, (engine) => engine.cancel(id));
  }

  async placeTrailingStop(
    userId: string,
    request: PlaceTrailingStopRequest,
  ): Promise<TrailingStopActionResult> {
    await this.#prepare(request.token);
    return this.#change(userId, (engine) => engine.placeTrailingStop(request));
  }

  async modifyTrailingStop(
    userId: string,
    id: string,
    request: ModifyTrailingStopRequest,
  ): Promise<TrailingStopActionResult> {
    const token = this.#engines.get(userId)?.getTrailingStop(id)?.token;
    if (token !== undefined) await this.#prepare(token);
    return this.#change(userId, (engine) => engine.modifyTrailingStop(id, request));
  }

  async cancelTrailingStop(userId: string, id: string): Promise<TrailingStopActionResult> {
    const token = this.#engines.get(userId)?.getTrailingStop(id)?.token;
    if (token !== undefined) await this.#prepare(token);
    return this.#change(userId, (engine) => engine.cancelTrailingStop(id));
  }

  /** Closes the user's position in one step (`PaperEngine.closePosition`); answers with the exit. */
  async closePosition(
    userId: string,
    token: InstrumentToken,
    product: ProductType,
  ): Promise<OrderActionResult> {
    await this.#prepare(token);
    return this.#change(userId, (engine) => engine.closePosition(token, product));
  }

  // ---- Reads (each syncs the user's engine first) --------------------------------------------

  getOrder(userId: string, id: string): Order | null {
    return this.#change(userId, (engine) => {
      engine.sync();
      return engine.getOrder(id);
    });
  }

  /** One page of the user's orders, newest first; `null` when the cursor is not one of them. */
  ordersPage(userId: string, query: OrdersPageQuery = {}): OrdersPage | null {
    const all = this.#change(userId, (engine) => {
      engine.sync();
      return engine.orders(query.status);
    });
    return newestFirstPage(all, query);
  }

  fundsSummary(userId: string): FundsSummary {
    return this.#change(userId, (engine) => {
      engine.sync();
      return engine.fundsSummary();
    });
  }

  /**
   * One page of the user's funds ledger (T-155), newest first; `null` when the cursor is not one
   * of their entries.
   */
  ledgerPage(userId: string, query: LedgerPageQuery = {}): LedgerPage | null {
    const all = this.#change(userId, (engine) => {
      engine.sync();
      return engine.ledger.entries();
    });
    return newestFirstPage(all, query);
  }

  /**
   * Resets the user's paper account (T-155): open orders are cancelled (and pushed as order
   * updates), positions and holdings cleared, and a `RESET` ledger entry brings available cash
   * back to the opening balance. Answers with the new funds summary.
   */
  reset(userId: string): FundsSummary {
    return this.#change(userId, (engine) => {
      engine.reset();
      return engine.fundsSummary();
    });
  }

  /**
   * The account's trading state at one `seq` (ADR 0012): today's and the working orders, today's
   * positions and trailing stops, and the funds. The trading store loads it on start and after a
   * gap in `accountDelta` frames.
   */
  async accountState(userId: string): Promise<AccountState> {
    const { seq, orders, trailingStops, funds } = this.#change(userId, (engine) => {
      engine.sync();
      const day = toIstParts(this.#options.clock.now());
      const since = fromIst(day.year, day.month, day.day, 0).toISOString();
      const today = (record: { updatedAt: string }) => record.updatedAt >= since;
      return {
        seq: engine.seq,
        orders: engine.orders().filter((order) => LIVE.has(order.status) || today(order)),
        trailingStops: engine
          .trailingStops()
          .filter(
            (stop) => STEPPED.has(stop.status) || stop.status === 'PENDING_ENTRY' || today(stop),
          ),
        funds: engine.fundsSummary(),
      };
    });
    const positions = await this.positions(userId);
    return {
      seq,
      orders: [...orders].reverse(),
      positions,
      trailingStops: [...trailingStops].reverse(),
      funds,
    };
  }

  /** Today's trailing stops, newest first (SPEC-TFC-1 §10.6). */
  trailingStops(userId: string): TrailingStop[] {
    const all = this.#change(userId, (engine) => {
      engine.sync();
      return engine.trailingStops();
    });
    return [...all].reverse();
  }

  /** The order's changes, oldest first (T-146); null when the user has no such order. */
  orderHistory(userId: string, id: string): OrderHistoryResponse | null {
    const items = this.#change(userId, (engine) => {
      engine.sync();
      return engine.orderHistory(id);
    });
    return items && items.length > 0 ? { orderId: id, items } : null;
  }

  /**
   * Today's positions (T-141), in the order they were opened, marked to the LTP the engines see
   * (P&L math from `positionValues`). An instrument without a price yet is valued at its average.
   */
  async positions(userId: string): Promise<Position[]> {
    const list = this.#change(userId, (engine) => {
      engine.sync();
      return engine.positions();
    });
    await Promise.all(list.map((position) => this.#ensurePrice(position.token)));
    return list.map(({ token, symbol, exchange, product, book }) => {
      const fallback = averagePrice(book) || Math.max(book.buyQty, book.sellQty, 1);
      const values = positionValues(book, this.ltp(token) ?? fallback);
      return {
        token,
        symbol,
        exchange,
        product,
        netQty: values.netQty,
        buyQty: values.buyQty,
        sellQty: values.sellQty,
        avgBuyPrice: values.avgBuyPrice,
        avgSellPrice: values.avgSellPrice,
        ltp: values.ltp,
        realisedPnl: values.realisedPnl,
        unrealisedPnl: values.unrealisedPnl,
      };
    });
  }

  /**
   * Delivery holdings carried from earlier days (T-141), by symbol, valued at the LTP the engines
   * see with the day's change against the previous close (`holdingValues`).
   */
  async holdings(userId: string): Promise<Holding[]> {
    const lots = this.#change(userId, (engine) => {
      engine.sync();
      return engine.holdings();
    });
    const master = await this.#master();
    const rows = await Promise.all(
      lots.map(async ({ token, lot }) => {
        const instrument = master.get(token);
        if (!instrument) return null;
        await this.#ensurePrice(token);
        const prevClose = await this.#prevClose(instrument);
        const avg = Math.max(1, Math.round(lot.investedValue / lot.qty));
        const ltp = this.ltp(token) ?? prevClose ?? avg;
        const values = holdingValues(lot, ltp, prevClose ?? ltp);
        const row: Holding = {
          token,
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          ...values,
        };
        return row;
      }),
    );
    return rows
      .filter((row): row is Holding => row !== null)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  /**
   * The portfolio summary (T-141): totals over the holdings rows (invested, current value, total
   * P&L and the day's P&L, so the summary always equals the sum of the rows), plus how many
   * holdings and positions there are. Percentages are basis points; the day's is against
   * yesterday's value (current value less the day's P&L).
   */
  async portfolioSummary(userId: string): Promise<PortfolioSummary> {
    const [holdings, positions] = await Promise.all([
      this.holdings(userId),
      this.positions(userId),
    ]);
    let investedValue = 0;
    let currentValue = 0;
    let dayPnl = 0;
    for (const holding of holdings) {
      investedValue += holding.investedValue;
      currentValue += holding.currentValue;
      dayPnl += holding.dayChange;
    }
    const totalPnl = currentValue - investedValue;
    return {
      investedValue,
      currentValue,
      totalPnl,
      totalPnlBp: basisPoints(totalPnl, investedValue),
      dayPnl,
      dayPnlBp: basisPoints(dayPnl, currentValue - dayPnl),
      holdingsCount: holdings.length,
      positionsCount: positions.length,
      asOf: this.#options.clock.now().toISOString(),
    };
  }

  /** The user's engine (created on first use), for read-only views such as positions. */
  engineOf(userId: string): PaperEngine {
    return this.#engineFor(userId);
  }

  // ---- Feed ----------------------------------------------------------------------------------

  /**
   * A batch of ticks: updates prices, then syncs the engines with live orders or stops in them.
   * A recent tick (a replayed one after a paused tab included) runs the engines at its own
   * timestamp, so a 15:20 square-off lands between the ticks either side of it (SPEC-TFC-1 §6.7).
   */
  ingest(quotes: readonly Quote[]): void {
    if (this.#disposed) return;
    const users = new Set<string>();
    let at = Number.NEGATIVE_INFINITY;
    for (const quote of quotes) {
      if (quote.ltp <= 0) continue;
      this.#ticks.set(quote.token, quote.ltp);
      this.#countTick(quote.token);
      at = Math.max(at, Date.parse(quote.ts));
      for (const userId of this.#liveUsers.get(quote.token) ?? []) users.add(userId);
    }
    const now = this.#options.clock.now().getTime();
    this.#tickAt = at <= now && now - at <= REPLAY_WINDOW_MS ? new Date(at) : null;
    try {
      for (const userId of users) this.#syncUser(userId);
    } finally {
      this.#tickAt = null;
    }
  }

  /**
   * One tick the matcher worker saw cross something of these users' (ADR 0013, NSTOCK-0367):
   * takes `ltp` as the instrument's price and syncs only these users' engines, at the tick's own
   * time when it is recent, as `ingest` does. The engine re-checks every order and stop, so a
   * request for an order that has since changed fills only what still crosses.
   */
  async ingestFor(
    userIds: Iterable<string>,
    tick: { token: InstrumentToken; ltp: number; ts: string },
  ): Promise<void> {
    if (this.#disposed || tick.ltp <= 0) return;
    await this.#prepare(tick.token);
    this.#ticks.set(tick.token, tick.ltp);
    this.#countTick(tick.token);
    const at = Date.parse(tick.ts);
    const now = this.#options.clock.now().getTime();
    this.#tickAt = at <= now && now - at <= REPLAY_WINDOW_MS ? new Date(at) : null;
    try {
      for (const userId of userIds) this.#syncUser(userId);
    } finally {
      this.#tickAt = null;
    }
  }

  /**
   * Symbols with a live order or an active trailing stop, for any user: the instruments the mock
   * market replays tick by tick after a paused tab (SPEC-TFC-1 §6.7).
   */
  activeSymbols(): string[] {
    const symbols: string[] = [];
    for (const token of this.#liveUsers.keys()) {
      const symbol = this.#instruments.get(token)?.info?.symbol;
      if (symbol !== undefined) symbols.push(symbol);
    }
    return symbols;
  }

  /**
   * Fixes the price the engines see for `token` until `unpinPrice`, whatever the feed says, and
   * syncs the engines with live orders in it: a scripted tick. Tests and scenarios use it.
   */
  pinPrice(token: InstrumentToken, ltp: number): void {
    if (!Number.isSafeInteger(ltp) || ltp <= 0) {
      throw new RangeError(`A pinned price must be positive paise, got ${String(ltp)}`);
    }
    this.#pins.set(token, ltp);
    this.#countTick(token);
    for (const userId of [...(this.#liveUsers.get(token) ?? [])]) this.#syncUser(userId);
  }

  unpinPrice(token: InstrumentToken): void {
    this.#pins.delete(token);
  }

  /**
   * Caps how many shares of a LIMIT order in `token` fill per tick, for every user; `null` lifts
   * the cap. The demo Simulator uses it to show partial fills (SPEC-TFC-1 TFC-10).
   */
  setFillCap(token: InstrumentToken, maxQty: number | null): void {
    if (maxQty === null) {
      this.#fillCaps.delete(token);
      return;
    }
    if (!Number.isSafeInteger(maxQty) || maxQty < 1) {
      throw new RangeError(
        `A fill cap must be a whole number of at least 1, got ${String(maxQty)}`,
      );
    }
    this.#fillCaps.set(token, maxQty);
  }

  /** The per-tick fill cap for `token`, or null when fills are whole. */
  fillCap(token: InstrumentToken): number | null {
    return this.#fillCaps.get(token) ?? null;
  }

  /**
   * Refreshes today's instrument data for every live order, then syncs every engine, so session
   * events (AMO release, square-off, close) happen, and are pushed, without a tick or a request.
   */
  async sweep(): Promise<void> {
    await Promise.all([...this.#liveUsers.keys()].map((token) => this.#prepare(token)));
    for (const [userId] of [...this.#engines.entries()]) this.#syncUser(userId);
  }

  /**
   * Carries a user's engine on from a snapshot (MSW after a reload), and gets instrument data and
   * prices for its live orders before the first sync needs them.
   */
  async restore(userId: string, snapshot: PaperEngineSnapshot): Promise<void> {
    const engine = this.#newEngine(userId, snapshot);
    await Promise.all([...activeTokens(engine)].map((token) => this.#prepare(token)));
    this.#engines.set(userId, engine);
    this.#reindex(userId, engine);
  }

  /**
   * Starts the user over with a new, empty engine (an account store that has no account for
   * them), dropping the one in memory without any change callbacks.
   */
  forget(userId: string): void {
    const engine = this.#newEngine(userId);
    this.#engines.set(userId, engine);
    this.#reindex(userId, engine);
  }

  /** Drops every adapter subscription. */
  dispose(): void {
    this.#disposed = true;
    for (const stop of this.#subscriptions.values()) stop();
    this.#subscriptions.clear();
  }

  // ---- Internals -----------------------------------------------------------------------------

  #change<T>(userId: string, run: (engine: PaperEngine) => T): T {
    const engine = this.#engineFor(userId);
    try {
      return run(engine);
    } finally {
      this.#reindex(userId, engine);
      this.#options.onChange?.(userId, engine);
    }
  }

  #countTick(token: InstrumentToken): void {
    this.#tickSeq.set(token, (this.#tickSeq.get(token) ?? 0) + 1);
  }

  #syncUser(userId: string): void {
    const engine = this.#engines.get(userId);
    if (!engine) return;
    const before = engine.seq;
    engine.sync();
    this.#reindex(userId, engine);
    if (engine.seq !== before) this.#options.onChange?.(userId, engine);
  }

  #engineFor(userId: string): PaperEngine {
    let engine = this.#engines.get(userId);
    if (!engine) {
      engine = this.#newEngine(userId);
      this.#engines.set(userId, engine);
    }
    return engine;
  }

  #newEngine(userId: string, snapshot?: PaperEngineSnapshot): PaperEngine {
    const { newId, onOrderUpdate, onTrailingStopUpdate, trailingStops } = this.#options;
    return new PaperEngine({
      ctx: createEngineContext({ clock: this.#engineClock, prices: this.#prices, nextId: newId }),
      instruments: this.#instrumentSource,
      holidays: this.#holidays,
      fillCap: (token) => this.fillCap(token),
      ...(this.#options.marketHours ? { marketHours: this.#options.marketHours } : {}),
      ...(onOrderUpdate ? { onOrderUpdate: (order: Order) => onOrderUpdate(userId, order) } : {}),
      ...(onTrailingStopUpdate
        ? { onTrailingStopUpdate: (stop: TrailingStop) => onTrailingStopUpdate(userId, stop) }
        : {}),
      ...(trailingStops === undefined ? {} : { trailingStops }),
      ...(snapshot ? { snapshot } : {}),
    });
  }

  /**
   * Records which instruments the user has live orders or active trailing stops in, so ticks find
   * their engine.
   */
  #reindex(userId: string, engine: PaperEngine): void {
    const next = activeTokens(engine);
    const previous = this.#liveTokens.get(userId) ?? new Set<InstrumentToken>();
    for (const token of previous) {
      if (next.has(token)) continue;
      const users = this.#liveUsers.get(token);
      users?.delete(userId);
      if (users?.size === 0) this.#liveUsers.delete(token);
    }
    for (const token of next) {
      const users = this.#liveUsers.get(token) ?? new Set<string>();
      users.add(userId);
      this.#liveUsers.set(token, users);
    }
    if (next.size === 0) this.#liveTokens.delete(userId);
    else this.#liveTokens.set(userId, next);
  }

  /**
   * Makes sure the engines can trade `token`: today's instrument data (names, circuit band), a
   * price, and a tick subscription. An unknown token or an index stays unknown, which the engine
   * refuses as `UNKNOWN_INSTRUMENT`.
   */
  async #prepare(token: InstrumentToken): Promise<void> {
    const day = istDateKey(this.#options.clock.now());
    if (this.#instruments.get(token)?.day === day && this.#subscriptions.has(token)) return;
    const instrument = (await this.#master()).get(token);
    if (instrument?.type !== 'EQUITY') {
      this.#instruments.set(token, { info: null, day });
      return;
    }
    const { symbol, exchange } = instrument;
    const [stats, quote] = await Promise.all([
      this.#options.market.getStats(symbol, exchange),
      this.#ticks.has(token) ? null : this.#options.market.getQuote(symbol, exchange),
    ]);
    this.#instruments.set(token, {
      info: stats
        ? {
            token,
            symbol,
            exchange,
            lowerCircuit: stats.lowerCircuit,
            upperCircuit: stats.upperCircuit,
          }
        : null,
      day,
    });
    if (quote && quote.ltp > 0 && !this.#ticks.has(token)) this.#ticks.set(token, quote.ltp);
    if (!this.#subscriptions.has(token) && !this.#disposed) {
      this.#subscriptions.set(
        token,
        this.#options.market.subscribe([symbol], (quotes) => this.ingest(quotes), exchange),
      );
    }
  }

  /** A price for `token` before valuing it: a tick, or else the adapter's quote (and a feed). */
  async #ensurePrice(token: InstrumentToken): Promise<void> {
    if (this.ltp(token) !== null) return;
    await this.#prepare(token);
  }

  /** Yesterday's close from the adapter's quote, cached per IST day; null when there is none. */
  async #prevClose(instrument: Instrument): Promise<number | null> {
    const day = istDateKey(this.#options.clock.now());
    const cached = this.#prevCloses.get(instrument.token);
    if (cached?.day === day) return cached.prevClose;
    const quote = await this.#options.market.getQuote(instrument.symbol, instrument.exchange);
    const prevClose = quote && quote.prevClose > 0 ? quote.prevClose : null;
    this.#prevCloses.set(instrument.token, { prevClose, day });
    return prevClose;
  }

  #master(): Promise<Map<InstrumentToken, Instrument>> {
    this.#symbolMaster ??= this.#options.market
      .listInstruments()
      .then((list) => new Map(list.map((instrument) => [instrument.token, instrument])));
    return this.#symbolMaster;
  }
}

/** A cursor page of `all` (oldest first) read newest first; `null` for an unknown cursor. */
function newestFirstPage<T extends { id: string }>(
  all: readonly T[],
  query: { cursor?: string; limit?: number },
): { items: T[]; nextCursor: string | null } | null {
  const newestFirst = [...all].reverse();
  let start = 0;
  if (query.cursor !== undefined) {
    const at = newestFirst.findIndex((item) => item.id === query.cursor);
    if (at < 0) return null;
    start = at + 1;
  }
  const limit = query.limit ?? PAGE_LIMIT_DEFAULT;
  const items = newestFirst.slice(start, start + limit);
  const last = items.at(-1);
  const more = start + limit < newestFirst.length;
  return { items, nextCursor: more && last ? last.id : null };
}

/** Instruments with a live order or a trailing stop that steps. */
function activeTokens(engine: PaperEngine): Set<InstrumentToken> {
  const tokens = new Set<InstrumentToken>();
  for (const order of engine.orders()) if (LIVE.has(order.status)) tokens.add(order.token);
  for (const stop of engine.trailingStops()) if (STEPPED.has(stop.status)) tokens.add(stop.token);
  return tokens;
}

function mapRegistry(): EngineRegistry {
  const engines = new Map<string, PaperEngine>();
  return {
    get: (userId) => engines.get(userId),
    set: (userId, engine) => {
      engines.set(userId, engine);
    },
    entries: () => engines.entries(),
  };
}
