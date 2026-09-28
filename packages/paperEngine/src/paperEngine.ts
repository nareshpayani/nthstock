import {
  Order as OrderSchema,
  OrderHistoryEntry as OrderHistoryEntrySchema,
  TICK_SIZE_PAISE,
  type Exchange,
  type FundsSummary,
  type InstrumentToken,
  type LedgerEntry,
  type ModifyOrderRequest,
  type Order,
  type OrderHistoryEntry,
  type OrderHistoryEvent,
  type OrderStatus,
  type PlaceOrderRequest,
  type ProductType,
  type TradingSymbol,
} from '@nthstock/contracts';
import {
  INTRADAY_SQUARE_OFF,
  MARKET_CLOSE,
  MARKET_OPEN,
  fromIst,
  getMarketStatus,
  isTradingDay,
  nseHolidays2026,
  toIstParts,
  type HolidayTable,
} from '@nthstock/utils';
import { assertPaise, assertQty, type EngineContext } from './context.js';
import { matchFill } from './fillMatcher.js';
import { FundsLedger, type FundsLedgerOptions, type LedgerResult } from './fundsLedger.js';
import type { InstrumentSource } from './instruments.js';
import {
  illegalTransitionReason,
  nextOrderStatus,
  transitionOrder,
  type OrderEvent,
} from './orderStateMachine.js';
import {
  isRequestError,
  validateOrder,
  type OrderDraft,
  type OrderRejectionCode,
} from './orderValidation.js';
import {
  EMPTY_POSITION,
  applyTrade,
  averagePrice,
  mulDivRound,
  type HoldingLot,
  type PositionBook,
} from './positionMath.js';

export type PaperEngineOptions = {
  ctx: EngineContext;
  instruments: InstrumentSource;
  /** Defaults to the NSE 2026 table. */
  holidays?: HolidayTable;
  /** Opening balance and the like for the funds ledger. */
  funds?: FundsLedgerOptions;
  /** Delivery holdings carried in from earlier days (seeded demo users, tests). */
  holdings?: Iterable<readonly [InstrumentToken, HoldingLot]>;
  /** Called with a copy of the order every time one is stored or changes (orderUpdate frames). */
  onOrderUpdate?: (order: Order) => void;
  /**
   * Carry on from a saved state (`snapshot()` of an earlier engine) instead of a fresh account.
   * `funds` and `holdings` must then be left out: the snapshot has both.
   */
  snapshot?: PaperEngineSnapshot;
};

export const PAPER_ENGINE_SNAPSHOT_VERSION = 1;

/**
 * An engine's whole state as plain JSON-safe data, for keeping it between page loads (MSW keeps
 * it in sessionStorage) or processes. Timestamps are ISO 8601 UTC; money is integer paise.
 */
export type PaperEngineSnapshot = {
  v: typeof PAPER_ENGINE_SNAPSHOT_VERSION;
  /** Session events up to this instant have run. */
  syncedTo: string;
  orders: Order[];
  /** Why each REJECTED order was rejected, by order id. */
  rejectCodes: [orderId: string, code: OrderRejectionCode][];
  positions: EnginePosition[];
  holdings: EngineHolding[];
  holdingSales: HoldingSale[];
  openingBalance: number;
  ledger: LedgerEntry[];
  /**
   * Each order's changes, oldest first, by order id (T-146). Snapshots saved before history was
   * kept have none; restoring one rebuilds a short history from each order's own fields.
   */
  history?: [orderId: string, entries: OrderHistoryEntry[]][];
};

export type OrderActionErrorCode =
  OrderRejectionCode | 'ORDER_NOT_FOUND' | 'ILLEGAL_TRANSITION' | 'NOTHING_TO_CHANGE';

/**
 * The outcome of place, modify or cancel. On failure `reason` is plain language; `order` is the
 * REJECTED order a risk check stored, or the unchanged order a refused modify or cancel left as
 * it was, or `null` when there is no order (a malformed request or an unknown id).
 */
export type OrderActionResult =
  | { ok: true; order: Order }
  | { ok: false; code: OrderActionErrorCode; reason: string; order: Order | null };

/** Today's position book for one instrument and product. */
export type EnginePosition = {
  token: InstrumentToken;
  symbol: TradingSymbol;
  exchange: Exchange;
  product: ProductType;
  book: PositionBook;
};

/** A delivery holding carried across days. */
export type EngineHolding = {
  token: InstrumentToken;
  lot: HoldingLot;
};

/**
 * Shares sold today out of holdings (not out of today's delivery buys). Their P&L is booked
 * against the holding's average cost.
 */
export type HoldingSale = {
  token: InstrumentToken;
  qty: number;
  /** Sale value in paise. */
  proceeds: number;
  realisedPnl: number;
};

/** Orders are kept mutable inside the engine; callers only ever get copies. */
type StoredOrder = Order;

const LIVE_STATUSES: ReadonlySet<OrderStatus> = new Set(['AMO', 'OPEN']);

const CANCELLED_BY_USER = 'Cancelled by you.';
const CANCELLED_BY_RESET = 'Cancelled when you reset your paper balance.';
const CANCELLED_AT_SQUARE_OFF = 'Cancelled at the 3:20 PM IST intraday square-off.';
const CANCELLED_AT_CLOSE = 'Cancelled at market close, 3:30 PM IST. Day orders do not carry over.';
const SQUARED_OFF = 'Squared off automatically at 3:20 PM IST.';

/**
 * The paper-trading engine (ADR 0004): one user's orders, positions, holdings and funds.
 *
 * Pure and deterministic: it reads time only from `ctx.now()`, prices only from `ctx.ltp()` and
 * instruments only from the injected source, so it runs unchanged in MSW and in apps/api.
 *
 * - `place()` validates (T-127) and stores the order as REJECTED, AMO (market closed) or OPEN,
 *   blocks cash for a BUY, and matches it at once when the market is open.
 * - `modify()` and `cancel()` follow the order state machine (T-128).
 * - `sync()` brings the engine up to the clock, then matches OPEN orders against current prices.
 *   Call it on every tick. Session events run on IST trading days only (market hours and
 *   holidays from `@nthstock/utils`): at 9:15 AMOs are released (T-129); at 15:20
 *   intraday is squared off and at 15:30 open orders are cancelled and delivery buys move to
 *   holdings (T-130).
 */
export class PaperEngine {
  readonly #ctx: EngineContext;
  readonly #instruments: InstrumentSource;
  readonly #holidays: HolidayTable;
  readonly #onOrderUpdate: ((order: Order) => void) | undefined;
  readonly #funds: FundsLedger;
  readonly #orders = new Map<string, StoredOrder>();
  readonly #byClientOrderId = new Map<string, string>();
  readonly #positions = new Map<string, EnginePosition>();
  readonly #holdings = new Map<InstrumentToken, HoldingLot>();
  readonly #holdingSales = new Map<InstrumentToken, HoldingSale>();
  readonly #rejectCodes = new Map<string, OrderRejectionCode>();
  readonly #history = new Map<string, OrderHistoryEntry[]>();
  readonly #collectors = new Set<Order[]>();
  /** Scheduled session events up to this instant have run. */
  #syncedTo: Date;
  /** While a scheduled event runs, the instant it was due; the engine's "now" for that event. */
  #eventAt: Date | null = null;
  /** Session events in IST minutes of each trading day, in time order. */
  readonly #schedule: readonly (readonly [minuteOfDay: number, run: () => void])[] = [
    [
      MARKET_OPEN,
      () => {
        this.#releaseAmos();
      },
    ],
    [
      INTRADAY_SQUARE_OFF,
      () => {
        this.#squareOffIntraday();
      },
    ],
    [
      MARKET_CLOSE,
      () => {
        this.#closeDay();
      },
    ],
  ];

  constructor(options: PaperEngineOptions) {
    this.#ctx = options.ctx;
    this.#instruments = options.instruments;
    this.#holidays = options.holidays ?? nseHolidays2026;
    this.#onOrderUpdate = options.onOrderUpdate;
    this.#syncedTo = this.#ctx.now();
    const { snapshot } = options;
    if (snapshot && (options.funds || options.holdings)) {
      throw new Error('Pass either a snapshot or funds and holdings, not both');
    }
    const ledgerCtx = {
      nowIso: () => this.#now().toISOString(),
      nextId: () => this.#ctx.nextId(),
    };
    this.#funds = new FundsLedger(
      ledgerCtx,
      snapshot
        ? { openingBalance: snapshot.openingBalance, entries: snapshot.ledger }
        : options.funds,
    );
    for (const [token, lot] of options.holdings ?? []) {
      assertQty(lot.qty, 'Holding quantity');
      this.#holdings.set(token, { ...lot });
    }
    if (snapshot) this.#restore(snapshot);
  }

  /** The whole state as plain data; `new PaperEngine({ ..., snapshot })` carries on from it. */
  snapshot(): PaperEngineSnapshot {
    return {
      v: PAPER_ENGINE_SNAPSHOT_VERSION,
      syncedTo: this.#syncedTo.toISOString(),
      orders: [...this.#orders.values()].map(copy),
      rejectCodes: [...this.#rejectCodes],
      positions: [...this.#positions.values()].map((p) => ({ ...p, book: { ...p.book } })),
      holdings: this.holdings() as EngineHolding[],
      holdingSales: this.holdingSales() as HoldingSale[],
      openingBalance: this.#funds.openingBalance,
      ledger: [...this.#funds.entries()],
      history: [...this.#history].map(([id, entries]) => [id, entries.map((e) => ({ ...e }))]),
    };
  }

  /** The funds ledger: balances and the append-only entries. */
  get ledger(): FundsLedger {
    return this.#funds;
  }

  /**
   * Places an order. Validation failures that still describe a real order (cash, holdings,
   * circuit, market hours) store it as REJECTED; malformed requests store nothing.
   */
  place(request: PlaceOrderRequest): OrderActionResult {
    this.sync();
    const clientOrderId = request.clientOrderId ?? null;
    const existingId =
      clientOrderId === null ? undefined : this.#byClientOrderId.get(clientOrderId);
    if (existingId !== undefined) return this.#result(this.#mustGet(existingId));

    const draft: OrderDraft = {
      token: request.token,
      side: request.side,
      type: request.type,
      product: request.product,
      qty: request.qty,
      price: request.price ?? null,
    };
    const instrument = this.#instruments.getInstrument(draft.token);
    const checked = validateOrder(draft, {
      now: this.#now(),
      holidays: this.#holidays,
      instrument,
      ltp: this.#ctx.ltp(draft.token),
      availableCash: this.#funds.available,
      sellableQty: this.#sellableQty(draft.token, null),
    });
    if (!checked.ok && isRequestError(checked.code)) {
      return { ok: false, code: checked.code, reason: checked.reason, order: null };
    }
    if (!instrument) throw new Error('unreachable: validation accepts only known instruments');

    const status: OrderStatus = !checked.ok ? 'REJECTED' : this.#marketOpen() ? 'OPEN' : 'AMO';
    const order = this.#newOrder(draft, instrument, status, clientOrderId);
    order.statusReason = checked.ok ? null : checked.reason;
    this.#orders.set(order.id, order);
    if (!checked.ok) this.#rejectCodes.set(order.id, checked.code);
    if (clientOrderId !== null) this.#byClientOrderId.set(clientOrderId, order.id);
    if (checked.ok && checked.blockAmount > 0) {
      this.#mustLedger(this.#funds.block(order.id, checked.blockAmount));
    }
    this.#record(order, 'PLACED', { note: order.statusReason });
    this.#emit(order);
    if (order.status === 'OPEN') this.#match(order);
    return this.#result(order);
  }

  /**
   * Changes qty, type or price of an AMO or OPEN order. The changed order is validated again
   * (with the cash it already has blocked); on failure the order stays as it was.
   */
  modify(id: string, request: ModifyOrderRequest): OrderActionResult {
    this.sync();
    const order = this.#orders.get(id);
    if (!order) return notFound();
    const refused = this.#refuse(order, 'MODIFY');
    if (refused) return refused;
    if (request.qty === undefined && request.type === undefined && request.price === undefined) {
      return {
        ok: false,
        code: 'NOTHING_TO_CHANGE',
        reason: 'Nothing to change.',
        order: copy(order),
      };
    }

    const type = request.type ?? order.type;
    const draft: OrderDraft = {
      token: order.token,
      side: order.side,
      type,
      product: order.product,
      qty: request.qty ?? order.qty,
      price: request.price ?? (type === 'MARKET' ? null : order.price),
    };
    const checked = validateOrder(draft, {
      now: this.#now(),
      holidays: this.#holidays,
      instrument: this.#instruments.getInstrument(order.token),
      ltp: this.#ctx.ltp(order.token),
      availableCash: this.#funds.available + this.#funds.blockedFor(order.id),
      sellableQty: this.#sellableQty(order.token, order.id),
    });
    if (!checked.ok) {
      return { ok: false, code: checked.code, reason: checked.reason, order: copy(order) };
    }

    this.#reblock(order.id, checked.blockAmount);
    order.status = transitionOrder(order.status, 'MODIFY');
    order.type = draft.type;
    order.qty = draft.qty;
    order.price = draft.price;
    order.updatedAt = this.#now().toISOString();
    this.#record(order, 'MODIFIED');
    this.#emit(order);
    if (order.status === 'OPEN') this.#match(order);
    return this.#result(order);
  }

  /** Cancels an AMO or OPEN order and releases its blocked cash. */
  cancel(id: string): OrderActionResult {
    this.sync();
    const order = this.#orders.get(id);
    if (!order) return notFound();
    const refused = this.#refuse(order, 'CANCEL');
    if (refused) return refused;
    this.#cancel(order, CANCELLED_BY_USER);
    return this.#result(order);
  }

  /**
   * Resets the paper account (T-155): cancels every AMO and OPEN order (each goes out as an order
   * update and releases its block), writes a `RESET` ledger entry that brings available cash back
   * to the opening balance, and clears orders, positions and holdings. The ledger keeps its
   * history (append-only). Returns the orders it cancelled.
   */
  reset(): readonly Order[] {
    this.sync();
    const cancelled: Order[] = [];
    for (const order of this.#orders.values()) {
      if (!LIVE_STATUSES.has(order.status)) continue;
      this.#cancel(order, CANCELLED_BY_RESET);
      cancelled.push(copy(order));
    }
    this.#mustLedger(this.#funds.reset());
    this.#orders.clear();
    this.#byClientOrderId.clear();
    this.#positions.clear();
    this.#holdings.clear();
    this.#holdingSales.clear();
    this.#rejectCodes.clear();
    this.#history.clear();
    return cancelled;
  }

  /**
   * Brings the engine up to the clock, then matches every OPEN order against its current LTP.
   * Returns the orders that changed (each once, latest state), in the order they changed.
   */
  sync(): readonly Order[] {
    const changed: Order[] = [];
    this.#collectors.add(changed);
    try {
      this.#runSchedule(this.#ctx.now());
      for (const order of this.#orders.values()) {
        if (order.status === 'OPEN') this.#match(order);
      }
    } finally {
      this.#collectors.delete(changed);
    }
    return latestById(changed);
  }

  getOrder(id: string): Order | null {
    const order = this.#orders.get(id);
    return order ? copy(order) : null;
  }

  /** The order's changes, oldest first (T-146), or null for an unknown id. */
  orderHistory(id: string): OrderHistoryEntry[] | null {
    const entries = this.#history.get(id);
    return entries ? entries.map((entry) => ({ ...entry })) : null;
  }

  /** Orders in the order they were placed, optionally only one status. */
  orders(status?: OrderStatus): readonly Order[] {
    return [...this.#orders.values()]
      .filter((order) => status === undefined || order.status === status)
      .map(copy);
  }

  /** Today's positions with any trades, in the order they were opened. */
  positions(): readonly EnginePosition[] {
    return [...this.#positions.values()]
      .filter(({ book }) => book.buyQty + book.sellQty > 0)
      .map((p) => ({ ...p, book: { ...p.book } }));
  }

  holdings(): readonly EngineHolding[] {
    return [...this.#holdings].map(([token, lot]) => ({ token, lot: { ...lot } }));
  }

  /** Shares sold out of holdings today. */
  holdingSales(): readonly HoldingSale[] {
    return [...this.#holdingSales.values()].map((sale) => ({ ...sale }));
  }

  /** Realised P&L of today's positions and of today's sales out of holdings. */
  realisedPnlToday(): number {
    let total = 0;
    for (const { book } of this.#positions.values()) total += book.realisedPnl;
    for (const sale of this.#holdingSales.values()) total += sale.realisedPnl;
    return total;
  }

  fundsSummary(): FundsSummary {
    return this.#funds.summary(this.realisedPnlToday());
  }

  #now(): Date {
    return this.#eventAt ?? this.#ctx.now();
  }

  /** Loads a snapshot, checking every order against the contract and every amount is paise. */
  #restore(snapshot: PaperEngineSnapshot): void {
    if (snapshot.v !== PAPER_ENGINE_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported engine snapshot version ${String(snapshot.v)}`);
    }
    const syncedTo = new Date(snapshot.syncedTo);
    if (Number.isNaN(syncedTo.getTime())) throw new RangeError('Invalid snapshot syncedTo');
    this.#syncedTo = syncedTo;
    for (const raw of snapshot.orders) {
      const order = OrderSchema.parse(raw);
      this.#orders.set(order.id, order);
      if (order.clientOrderId !== null) this.#byClientOrderId.set(order.clientOrderId, order.id);
    }
    const saved = new Map(snapshot.history ?? []);
    for (const order of this.#orders.values()) {
      const entries = saved.get(order.id);
      this.#history.set(
        order.id,
        entries && entries.length > 0
          ? entries.map((entry) => OrderHistoryEntrySchema.parse(entry))
          : historyFromOrder(order),
      );
    }
    for (const [id, code] of snapshot.rejectCodes) {
      if (this.#orders.get(id)?.status === 'REJECTED') this.#rejectCodes.set(id, code);
    }
    for (const position of snapshot.positions) {
      for (const value of Object.values(position.book)) assertPaise(value, 'Position value');
      const key = `${String(position.token)}:${position.product}`;
      this.#positions.set(key, { ...position, book: { ...position.book } });
    }
    for (const { token, lot } of snapshot.holdings) {
      assertQty(lot.qty, 'Holding quantity');
      assertPaise(lot.investedValue, 'Holding value');
      this.#holdings.set(token, { ...lot });
    }
    for (const sale of snapshot.holdingSales) {
      assertQty(sale.qty, 'Sold quantity');
      assertPaise(sale.proceeds, 'Sale proceeds');
      assertPaise(sale.realisedPnl, 'Sale P&L');
      this.#holdingSales.set(sale.token, { ...sale });
    }
  }

  /**
   * Runs every session event due after the last sync and up to `until`, in time order, each at
   * its own instant (timestamps and market hours read that instant, prices are current). Only
   * trading days have events.
   */
  #runSchedule(until: Date): void {
    const from = this.#syncedTo;
    if (until.getTime() <= from.getTime()) {
      // A clock moved backwards (a test override): follow it. Every event acts only on the
      // current state (AMOs waiting, open intraday positions, open day orders), so running one
      // again later never repeats work already done.
      this.#syncedTo = until;
      return;
    }
    const start = toIstParts(from);
    for (let offset = 0; ; offset += 1) {
      const dayStart = fromIst(start.year, start.month, start.day + offset, 0);
      if (dayStart.getTime() > until.getTime()) break;
      if (!isTradingDay(dayStart, this.#holidays)) continue;
      for (const [minute, run] of this.#schedule) {
        const at = fromIst(start.year, start.month, start.day + offset, minute);
        if (at.getTime() <= from.getTime() || at.getTime() > until.getTime()) continue;
        this.#eventAt = at;
        try {
          run();
        } finally {
          this.#eventAt = null;
        }
      }
    }
    this.#syncedTo = until;
  }

  /**
   * 9:15 IST (T-129): every AMO goes to the exchange in the order it was placed. It is validated
   * again at the opening price, circuit band, cash and holdings; a failure rejects it with the
   * reason and releases its cash. Otherwise it becomes OPEN, a MARKET BUY's block moves to
   * qty × the opening LTP, and it is matched at once.
   */
  #releaseAmos(): void {
    for (const order of this.#orders.values()) {
      if (order.status !== 'AMO') continue;
      const checked = validateOrder(order, {
        now: this.#now(),
        holidays: this.#holidays,
        instrument: this.#instruments.getInstrument(order.token),
        ltp: this.#ctx.ltp(order.token),
        availableCash: this.#funds.available + this.#funds.blockedFor(order.id),
        sellableQty: this.#sellableQty(order.token, order.id),
      });
      order.updatedAt = this.#now().toISOString();
      if (!checked.ok) {
        this.#funds.release(order.id);
        order.status = transitionOrder(order.status, 'REJECT');
        order.statusReason = checked.reason;
        this.#rejectCodes.set(order.id, checked.code);
        this.#record(order, 'REJECTED', { note: checked.reason });
        this.#emit(order);
        continue;
      }
      this.#reblock(order.id, checked.blockAmount);
      order.status = transitionOrder(order.status, 'RELEASE');
      this.#record(order, 'RELEASED');
      this.#emit(order);
      this.#match(order);
    }
  }
  /**
   * 15:20 IST (T-130): cancels OPEN intraday orders, then closes every open intraday position
   * with a MARKET order at the LTP (at the position's average price, on the tick, if there is no
   * LTP). The buy-back of a short always settles, even into a debit balance.
   */
  #squareOffIntraday(): void {
    for (const order of this.#orders.values()) {
      if (order.status === 'OPEN' && order.product === 'INTRADAY') {
        this.#cancel(order, CANCELLED_AT_SQUARE_OFF);
      }
    }
    for (const position of this.#positions.values()) {
      const { book } = position;
      if (position.product !== 'INTRADAY' || book.netQty === 0) continue;
      const draft: OrderDraft = {
        token: position.token,
        side: book.netQty > 0 ? 'SELL' : 'BUY',
        type: 'MARKET',
        product: 'INTRADAY',
        qty: Math.abs(book.netQty),
        price: null,
      };
      const order = this.#newOrder(draft, position, 'OPEN', null);
      order.statusReason = SQUARED_OFF;
      this.#orders.set(order.id, order);
      this.#record(order, 'PLACED', { note: SQUARED_OFF });
      const price = this.#ctx.ltp(position.token) ?? onTick(averagePrice(book));
      this.#execute(order, draft.qty, price, true);
    }
  }

  /**
   * 15:30 IST (T-130): cancels every OPEN order (day orders do not carry over), moves today's
   * delivery buys into holdings at their cost, and starts a fresh day of positions. AMOs placed
   * after the close wait for the next session.
   */
  #closeDay(): void {
    this.#squareOffIntraday();
    for (const order of this.#orders.values()) {
      if (order.status === 'OPEN') this.#cancel(order, CANCELLED_AT_CLOSE);
    }
    for (const position of this.#positions.values()) {
      if (position.product !== 'DELIVERY' || position.book.netQty <= 0) continue;
      const lot = this.#holdings.get(position.token) ?? { qty: 0, investedValue: 0 };
      lot.qty += position.book.netQty;
      lot.investedValue += position.book.openCost;
      this.#holdings.set(position.token, lot);
    }
    this.#positions.clear();
    this.#holdingSales.clear();
  }

  #marketOpen(): boolean {
    return getMarketStatus({ now: () => this.#now() }, this.#holidays).state === 'open';
  }

  #newOrder(
    draft: OrderDraft,
    names: { symbol: TradingSymbol; exchange: Exchange },
    status: OrderStatus,
    clientOrderId: string | null,
  ): StoredOrder {
    const now = this.#now().toISOString();
    return {
      id: this.#ctx.nextId(),
      clientOrderId,
      token: draft.token,
      symbol: names.symbol,
      exchange: names.exchange,
      side: draft.side,
      type: draft.type,
      product: draft.product,
      qty: draft.qty,
      price: draft.price,
      filledQty: 0,
      avgFillPrice: null,
      status,
      statusReason: null,
      placedAt: now,
      updatedAt: now,
    };
  }

  #refuse(order: StoredOrder, event: OrderEvent): OrderActionResult | null {
    if (nextOrderStatus(order.status, event) !== null) return null;
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      reason: illegalTransitionReason(order.status, event),
      order: copy(order),
    };
  }

  #cancel(order: StoredOrder, reason: string): void {
    this.#funds.release(order.id);
    order.status = transitionOrder(order.status, 'CANCEL');
    order.statusReason = reason;
    order.updatedAt = this.#now().toISOString();
    this.#record(order, 'CANCELLED', { note: reason });
    this.#emit(order);
  }

  /** Moves the order's block to `amount`: blocks more or releases the difference. */
  #reblock(orderId: string, amount: number): void {
    const held = this.#funds.blockedFor(orderId);
    if (amount > held) this.#mustLedger(this.#funds.block(orderId, amount - held));
    else if (amount < held) this.#mustLedger(this.#funds.release(orderId, held - amount));
  }

  #match(order: StoredOrder): void {
    const ltp = this.#ctx.ltp(order.token);
    if (ltp === null) return;
    const fill = matchFill(order, ltp);
    if (fill) this.#execute(order, fill.qty, fill.price);
  }

  /** Settles a fill of the whole remaining quantity and books it into positions and holdings. */
  #execute(order: StoredOrder, qty: number, price: number, squareOff = false): void {
    const value = qty * price;
    if (order.side === 'SELL') this.#mustLedger(this.#funds.settleSell(order.id, value));
    else if (squareOff) this.#mustLedger(this.#funds.settleForcedBuy(order.id, value));
    else this.#mustLedger(this.#funds.settleBuy(order.id, value));

    const trade = { side: order.side, qty, price };
    if (order.product === 'DELIVERY' && order.side === 'SELL') {
      const position = this.#position(order, 'DELIVERY');
      const fromToday = Math.min(qty, Math.max(0, position.book.netQty));
      if (fromToday > 0) position.book = applyTrade(position.book, { ...trade, qty: fromToday });
      if (qty > fromToday) this.#sellFromHoldings(order.token, qty - fromToday, price);
    } else {
      const position = this.#position(order, order.product);
      position.book = applyTrade(position.book, trade);
    }

    order.status = transitionOrder(order.status, 'FILL');
    order.filledQty += qty;
    order.avgFillPrice = price;
    order.updatedAt = this.#now().toISOString();
    this.#record(order, 'EXECUTED', { fillPrice: price });
    this.#emit(order);
  }

  #sellFromHoldings(token: InstrumentToken, qty: number, price: number): void {
    const lot = this.#holdings.get(token);
    if (!lot || lot.qty < qty) {
      throw new Error(
        `Invariant broken: selling ${String(qty)} of token ${String(token)} from holdings`,
      );
    }
    const cost = mulDivRound(lot.investedValue, qty, lot.qty);
    lot.qty -= qty;
    lot.investedValue -= cost;
    if (lot.qty === 0) this.#holdings.delete(token);
    const sale = this.#holdingSales.get(token) ?? { token, qty: 0, proceeds: 0, realisedPnl: 0 };
    sale.qty += qty;
    sale.proceeds += qty * price;
    sale.realisedPnl += qty * price - cost;
    this.#holdingSales.set(token, sale);
  }

  #position(order: StoredOrder, product: ProductType): EnginePosition {
    const key = `${String(order.token)}:${product}`;
    let position = this.#positions.get(key);
    if (!position) {
      const { token, symbol, exchange } = order;
      position = { token, symbol, exchange, product, book: { ...EMPTY_POSITION } };
      this.#positions.set(key, position);
    }
    return position;
  }

  /**
   * Shares a delivery SELL may use: holdings plus today's delivery buys, less the unfilled
   * quantity of other AMO and OPEN delivery SELL orders in the same instrument.
   */
  #sellableQty(token: InstrumentToken, excludeOrderId: string | null): number {
    const held = this.#holdings.get(token)?.qty ?? 0;
    const boughtToday = Math.max(
      0,
      this.#positions.get(`${String(token)}:DELIVERY`)?.book.netQty ?? 0,
    );
    let pending = 0;
    for (const order of this.#orders.values()) {
      if (
        order.id !== excludeOrderId &&
        order.token === token &&
        order.side === 'SELL' &&
        order.product === 'DELIVERY' &&
        LIVE_STATUSES.has(order.status)
      ) {
        pending += order.qty - order.filledQty;
      }
    }
    return held + boughtToday - pending;
  }

  /** Appends one change to the order's history, with the order's terms after it. */
  #record(
    order: StoredOrder,
    event: OrderHistoryEvent,
    extra: { fillPrice?: number; note?: string | null } = {},
  ): void {
    const entries = this.#history.get(order.id) ?? [];
    // PLACED reuses placedAt: reading the clock again can land a millisecond later.
    const at = event === 'PLACED' ? order.placedAt : this.#now().toISOString();
    entries.push(historyEntry(order, event, at, extra));
    this.#history.set(order.id, entries);
  }

  #mustLedger(result: LedgerResult): void {
    // Validation checks cash before every block and settle, so a refusal here is a bug.
    if (!result.ok) throw new Error(`Invariant broken: ${result.reason}`);
  }

  #mustGet(id: string): StoredOrder {
    const order = this.#orders.get(id);
    if (!order) throw new Error(`Invariant broken: order ${id} missing`);
    return order;
  }

  #emit(order: StoredOrder): void {
    const snapshot = copy(order);
    for (const collector of this.#collectors) collector.push(snapshot);
    this.#onOrderUpdate?.(snapshot);
  }

  #result(order: StoredOrder): OrderActionResult {
    const code = this.#rejectCodes.get(order.id);
    if (order.status === 'REJECTED' && code !== undefined) {
      return { ok: false, code, reason: order.statusReason ?? '', order: copy(order) };
    }
    return { ok: true, order: copy(order) };
  }
}

function notFound(): OrderActionResult {
  return { ok: false, code: 'ORDER_NOT_FOUND', reason: 'This order was not found.', order: null };
}

/** A detached copy, so callers can't change engine state. */
function copy(order: StoredOrder): Order {
  return { ...order };
}

function historyEntry(
  order: Order,
  event: OrderHistoryEvent,
  at: string,
  extra: { fillPrice?: number; note?: string | null } = {},
): OrderHistoryEntry {
  return {
    event,
    status: order.status,
    at,
    qty: order.qty,
    type: order.type,
    price: order.price,
    fillPrice: extra.fillPrice ?? null,
    note: extra.note ?? null,
  };
}

/**
 * A history for an order restored from a snapshot that kept none: placed at `placedAt`, then
 * (when it has moved on) its last change at `updatedAt`. Modifications in between are unknown.
 */
function historyFromOrder(order: Order): OrderHistoryEntry[] {
  const rejectedAtPlace = order.status === 'REJECTED' && order.placedAt === order.updatedAt;
  const initial: OrderStatus =
    order.status === 'AMO' ? 'AMO' : rejectedAtPlace ? 'REJECTED' : 'OPEN';
  const placed = historyEntry({ ...order, status: initial }, 'PLACED', order.placedAt, {
    note: rejectedAtPlace ? order.statusReason : null,
  });
  if (order.status === initial) return [placed];
  const last: Record<Exclude<OrderStatus, 'AMO'>, OrderHistoryEvent> = {
    OPEN: 'RELEASED',
    EXECUTED: 'EXECUTED',
    CANCELLED: 'CANCELLED',
    REJECTED: 'REJECTED',
  };
  const event = last[order.status as Exclude<OrderStatus, 'AMO'>];
  return [
    placed,
    historyEntry(order, event, order.updatedAt, {
      ...(order.status === 'EXECUTED' && order.avgFillPrice !== null
        ? { fillPrice: order.avgFillPrice }
        : {}),
      note: order.status === 'EXECUTED' ? null : order.statusReason,
    }),
  ];
}

function latestById(orders: readonly Order[]): readonly Order[] {
  const latest = new Map<string, Order>();
  for (const order of orders) {
    latest.delete(order.id);
    latest.set(order.id, order);
  }
  return [...latest.values()];
}

/** The nearest price on the 5-paise tick, at least one tick. */
function onTick(paise: number): number {
  return Math.max(TICK_SIZE_PAISE, Math.round(paise / TICK_SIZE_PAISE) * TICK_SIZE_PAISE);
}
