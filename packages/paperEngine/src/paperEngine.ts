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
  type OrderValidity,
  type PlaceOrderRequest,
  type ModifyTrailingStopRequest,
  type PlaceTrailingStopRequest,
  type PositionDirection,
  type ProductType,
  type TradingSymbol,
  type TrailingStop,
  type TrailingStopParams,
  type TrailingStopStatus,
  TrailingStop as TrailingStopSchema,
  TRAILING_STOP_MESSAGES,
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
  formatInr,
  type HolidayTable,
} from '@nthstock/utils';
import { assertPaise, assertQty, type EngineContext } from './context.js';
import { matchFill } from './fillMatcher.js';
import {
  FundsLedger,
  type FundsLedgerOptions,
  type LedgerCarried,
  type LedgerResult,
} from './fundsLedger.js';
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
  type MarketHours,
  type OrderDraft,
  type OrderRejectionCode,
  type ValidationResult,
} from './orderValidation.js';
import {
  EMPTY_POSITION,
  applyTrade,
  averagePrice,
  mulDivRound,
  type HoldingLot,
  type PositionBook,
} from './positionMath.js';
import {
  modifyTrailingStop as applyStopModify,
  stepTrailingStop,
  validateStopPrice,
  validateTrailingStop,
  type TrailingStopCheck,
  type TrailingStopState,
} from './trailingStop.js';

export type PaperEngineOptions = {
  ctx: EngineContext;
  instruments: InstrumentSource;
  /** Defaults to the NSE 2026 table. */
  holidays?: HolidayTable;
  /**
   * `nse` (default) or `alwaysOpen`. Always open accepts Intraday orders and fills orders at any
   * hour instead of holding them as AMOs; the session schedule (9:15 release, 15:20 square-off,
   * close) still runs on trading days.
   */
  marketHours?: MarketHours;
  /** Opening balance and the like for the funds ledger. */
  funds?: FundsLedgerOptions;
  /** Delivery holdings carried in from earlier days (seeded demo users, tests). */
  holdings?: Iterable<readonly [InstrumentToken, HoldingLot]>;
  /** Called with a copy of the order every time one is stored or changes (orderUpdate frames). */
  onOrderUpdate?: (order: Order) => void;
  /** Called with a copy of the trailing stop every time one is stored or changes. */
  onTrailingStopUpdate?: (stop: TrailingStop) => void;
  /** False refuses trailing stops, standalone and attached, as `NOT_SUPPORTED`. Default true. */
  trailingStops?: boolean;
  /**
   * The most shares a LIMIT order in `token` may fill per tick, or null for no cap (SPEC-TFC-1
   * TFC-10). The demo Simulator sets it to split large fills; MARKET orders always fill in full.
   */
  fillCap?: (token: InstrumentToken) => number | null;
  /**
   * Carry on from a saved state (`snapshot()` of an earlier engine) instead of a fresh account.
   * `funds` and `holdings` must then be left out: the snapshot has both.
   */
  snapshot?: PaperEngineSnapshot;
};

/**
 * The full snapshot's version. Version 1 had no trailing stops and no `seq`; it still restores
 * (SPEC-TFC-1 §10.3). Version 2 is the working set, so trailing stops arrived as version 3. The
 * working set took trailing stops and `seq` as version 4 (NSTOCK-0368); version 2 still restores.
 */
export const PAPER_ENGINE_SNAPSHOT_VERSION = 3;
export const PAPER_ENGINE_LEGACY_SNAPSHOT_VERSION = 1;
export const PAPER_ENGINE_WORKING_SET_VERSION = 4;
export const PAPER_ENGINE_LEGACY_WORKING_SET_VERSION = 2;

/**
 * An engine's whole state as plain JSON-safe data, for keeping it between page loads (MSW keeps
 * it in sessionStorage) or processes. Timestamps are ISO 8601 UTC; money is integer paise.
 */
export type PaperEngineSnapshotV1 = {
  v: typeof PAPER_ENGINE_LEGACY_SNAPSHOT_VERSION;
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

/**
 * The full snapshot (v3): version 1 plus trailing stops and the engine `seq` (SPEC-TFC-1 §10.3).
 */
export type PaperEngineSnapshotV3 = Omit<PaperEngineSnapshotV1, 'v' | 'history'> & {
  v: typeof PAPER_ENGINE_SNAPSHOT_VERSION;
  history: [orderId: string, entries: OrderHistoryEntry[]][];
  /** The engine sequence number of the last change. */
  seq: number;
  trailingStops: TrailingStop[];
  /** Orders the engine placed to close a position (trailing-stop exits, `closePosition`). */
  exitOrderIds: string[];
  /** Idempotency keys of placed trailing stops. */
  trailingStopRequestIds: [clientRequestId: string, trailingStopId: string][];
};

/**
 * The working set (T-199): what a store needs to carry an account on without loading its whole
 * history. Orders are today's (placed or changed since the start of the IST day of `syncedTo`) and
 * the live ones (AMO, OPEN); positions and holding sales are today's anyway; all holdings; and the
 * ledger is a carried balance plus today's entries. Older orders stay in the store; the engine
 * only needs them for idempotent client order ids, which then no longer match.
 *
 * Version 4 (NSTOCK-0368) adds the engine `seq` and the trailing stops on the same rule as orders
 * (today's and the active ones), with the exit orders and idempotency keys that belong to what it
 * keeps. Orders still leave their own `seq` out: a store keeps the account's.
 */
export type PaperEngineWorkingSet = Omit<PaperEngineWorkingSetV2, 'v'> & {
  v: typeof PAPER_ENGINE_WORKING_SET_VERSION;
  /** The engine sequence number of the last change. */
  seq: number;
  trailingStops: TrailingStop[];
  /** Kept orders the engine placed to close a position (see the full snapshot). */
  exitOrderIds: string[];
  /** Idempotency keys of the kept trailing stops. */
  trailingStopRequestIds: [clientRequestId: string, trailingStopId: string][];
};

/** The working set before trailing stops (v2): it restores with none and `seq` from its records. */
export type PaperEngineWorkingSetV2 = {
  v: typeof PAPER_ENGINE_LEGACY_WORKING_SET_VERSION;
  syncedTo: string;
  orders: Order[];
  rejectCodes: [orderId: string, code: OrderRejectionCode][];
  positions: EnginePosition[];
  holdings: EngineHolding[];
  holdingSales: HoldingSale[];
  openingBalance: number;
  ledger: { carried: LedgerCarried; entries: LedgerEntry[] };
  history: [orderId: string, entries: OrderHistoryEntry[]][];
};

/**
 * What an engine restores from: a full snapshot (v3, or a v1 saved before trailing stops) or a
 * working set (v4, or a v2 saved before trailing stops). The working set is apps/api's store format.
 */
export type PaperEngineSnapshot =
  PaperEngineSnapshotV1 | PaperEngineSnapshotV3 | PaperEngineWorkingSet | PaperEngineWorkingSetV2;

export type OrderActionErrorCode =
  | OrderRejectionCode
  | TrailingStopCheckCode
  | 'ORDER_NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'NOTHING_TO_CHANGE'
  | 'NOT_SUPPORTED';

/** A trailing stop's parameters failed a SPEC-TFC-1 §6.6 rule; the reason is its message. */
export type TrailingStopCheckCode =
  'NO_POSITION' | 'INVALID_TRAIL' | 'INVALID_STOP_PRICE' | 'INVALID_LIMIT_OFFSET';

export type TrailingStopActionErrorCode =
  | TrailingStopCheckCode
  | 'TRAILING_STOP_NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'NOTHING_TO_CHANGE'
  | 'NO_PRICE'
  | 'NOT_SUPPORTED';

/**
 * The outcome of placing, modifying or cancelling a trailing stop. On failure `reason` is plain
 * language and `trailingStop` the unchanged stop, or null when there is none.
 */
export type TrailingStopActionResult =
  | { ok: true; trailingStop: TrailingStop }
  | {
      ok: false;
      code: TrailingStopActionErrorCode;
      reason: string;
      trailingStop: TrailingStop | null;
    };

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
type StoredStop = TrailingStop;

const LIVE_STATUSES: ReadonlySet<OrderStatus> = new Set(['AMO', 'OPEN']);

const CANCELLED_BY_USER = 'Cancelled by you.';
const CANCELLED_BY_RESET = 'Cancelled when you reset your paper balance.';
const CANCELLED_AT_SQUARE_OFF = 'Cancelled at the 3:20 PM IST intraday square-off.';
const CANCELLED_AT_CLOSE = 'Cancelled at market close, 3:30 PM IST. Day orders do not carry over.';
const SQUARED_OFF = 'Squared off automatically at 3:20 PM IST.';
const IOC_NEEDS_OPEN_MARKET =
  'Immediate-or-cancel orders can be placed only while the market is open.';

/** Trailing stops that still act: the attached ones waiting for their entry, and the live ones. */
const ACTIVE_STOP_STATUSES: ReadonlySet<TrailingStopStatus> = new Set([
  'PENDING_ENTRY',
  'ARMED',
  'TRAILING',
  'TRIGGERED',
]);
/** Trailing stops that protect an open position. */
const PROTECTING_STOP_STATUSES: ReadonlySet<TrailingStopStatus> = new Set([
  'ARMED',
  'TRAILING',
  'TRIGGERED',
]);
/** Trailing stops the user may still change (SPEC-TFC-1 §6.5). */
const MODIFIABLE_STOP_STATUSES: ReadonlySet<TrailingStopStatus> = new Set([
  'PENDING_ENTRY',
  'ARMED',
  'TRAILING',
]);

// Trailing-stop reasons (SPEC-TFC-1 §6.4). The spec's words, so every surface shows the same.
const STOP_POSITION_CLOSED = 'Position closed';
const STOP_EXPIRED = 'Expired at close';
const STOP_REPLACED = 'Replaced by a new trailing stop';
const STOP_ENTRY_CANCELLED = 'Entry order cancelled before it filled';
const STOP_ENTRY_REJECTED = 'Entry order rejected';
const STOP_NOTHING_TO_PROTECT = 'The entry order did not open a position to protect';
const TRAILING_STOPS_UNAVAILABLE = 'Trailing stops are not available in this mode.';
const EXIT_CANCELLED_WITH_STOP = 'Cancelled with its trailing stop.';
const EXIT_NOT_NEEDED = 'Reduce-only exit: the position is already closed.';
const CANCELLED_FOR_CLOSE = 'Cancelled when you closed the position.';
const SELL_UNCOVERED = 'Cancelled: an exit already sold the shares this order would sell.';
const CLOSE_EXIT = 'Exit to close the position.';
const NO_POSITION_TO_CLOSE = 'There is no open position to close.';

/** "Trailing stop exit: the price reached the stop at ₹1,480.00." */
function stopExitReason(stopPrice: number): string {
  return `Trailing stop exit: the price reached the stop at ${formatInr(stopPrice)}.`;
}

const STOP_STATUS_WORDS: Record<TrailingStopStatus, string> = {
  PENDING_ENTRY: 'waiting for its entry',
  ARMED: 'armed',
  TRAILING: 'trailing',
  TRIGGERED: 'triggered',
  EXECUTED: 'exited',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
};

/** "Immediate or cancel: 7 of 10 shares did not fill and were cancelled." */
function iocCancelReason(unfilled: number, qty: number): string {
  return `Immediate or cancel: ${String(unfilled)} of ${String(qty)} shares did not fill and were cancelled.`;
}

/**
 * The paper-trading engine (ADR 0004): one user's orders, positions, holdings and funds.
 *
 * Pure and deterministic: it reads time only from `ctx.now()`, prices only from `ctx.ltp()` and
 * instruments only from the injected source, so it runs unchanged in MSW and in apps/api.
 *
 * - `place()` validates (T-127) and stores the order as REJECTED, AMO (market closed) or OPEN,
 *   blocks cash for a BUY, and matches it at once when the market is open. An IOC order then
 *   cancels whatever did not fill.
 * - Fills (SPEC-TFC-1 §10.3): a LIMIT order may fill in parts under a per-tick cap and stays OPEN
 *   until the last share fills; `avgFillPrice` is the volume-weighted average, and each part
 *   releases its share of the blocked cash. A marketable limit fills at the better of its limit
 *   and the LTP when it arrives.
 * - `modify()` and `cancel()` follow the order state machine (T-128).
 * - `sync()` brings the engine up to the clock, then matches OPEN orders against current prices.
 *   Call it on every tick. Session events run on IST trading days only (market hours and
 *   holidays from `@nthstock/utils`): at 9:15 AMOs are released (T-129); at 15:20
 *   intraday is squared off and at 15:30 open orders are cancelled and delivery buys move to
 *   holdings (T-130).
 * - Trailing stops (SPEC-TFC-1 §6): one per position, placed on an open position or attached to
 *   an entry order. Each sync steps them after matching orders; a trigger places one reduce-only
 *   exit. After every fill a stop follows its position: it protects the open quantity, and is
 *   cancelled when the position closes or flips by any other means. `closePosition` closes a
 *   position in one step. Stops expire at the 15:20 square-off (Intraday) and the close (Delivery).
 * - `seq` rises by one with every order or trailing-stop change, and each changed record carries
 *   it (ADR 0012).
 */
export class PaperEngine {
  readonly #ctx: EngineContext;
  readonly #instruments: InstrumentSource;
  readonly #holidays: HolidayTable;
  readonly #marketHours: MarketHours;
  readonly #onOrderUpdate: ((order: Order) => void) | undefined;
  readonly #onTrailingStopUpdate: ((stop: TrailingStop) => void) | undefined;
  readonly #trailingStopsEnabled: boolean;
  readonly #fillCap: (token: InstrumentToken) => number | null;
  /** The tick each capped order last filled on, so it fills at most once per tick. */
  readonly #cappedFillTick = new Map<string, number>();
  readonly #funds: FundsLedger;
  readonly #orders = new Map<string, StoredOrder>();
  readonly #byClientOrderId = new Map<string, string>();
  readonly #positions = new Map<string, EnginePosition>();
  readonly #holdings = new Map<InstrumentToken, HoldingLot>();
  readonly #holdingSales = new Map<InstrumentToken, HoldingSale>();
  readonly #rejectCodes = new Map<string, OrderRejectionCode>();
  readonly #history = new Map<string, OrderHistoryEntry[]>();
  readonly #collectors = new Set<Order[]>();
  readonly #stops = new Map<string, StoredStop>();
  readonly #stopByRequestId = new Map<string, string>();
  /** The PENDING_ENTRY stop attached to each entry order, by order id. */
  readonly #stopByEntry = new Map<string, string>();
  /**
   * Orders the engine placed to close a position: trailing-stop exits and `closePosition`. They
   * are reduce-only (a fill never takes the position past flat), and a buy-back settles like the
   * square-off, so it is never refused for cash.
   */
  readonly #exits = new Set<string>();
  /** The sequence number of the last change (ADR 0012). */
  #seq = 0;
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
    this.#marketHours = options.marketHours ?? 'nse';
    this.#onOrderUpdate = options.onOrderUpdate;
    this.#onTrailingStopUpdate = options.onTrailingStopUpdate;
    this.#trailingStopsEnabled = options.trailingStops ?? true;
    this.#fillCap = options.fillCap ?? (() => null);
    this.#syncedTo = this.#ctx.now();
    const { snapshot } = options;
    if (snapshot && (options.funds || options.holdings)) {
      throw new Error('Pass either a snapshot or funds and holdings, not both');
    }
    const ledgerCtx = {
      nowIso: () => this.#now().toISOString(),
      nextId: () => this.#ctx.nextId(),
    };
    this.#funds = new FundsLedger(ledgerCtx, snapshot ? ledgerOptions(snapshot) : options.funds);
    for (const [token, lot] of options.holdings ?? []) {
      assertQty(lot.qty, 'Holding quantity');
      this.#holdings.set(token, { ...lot });
    }
    if (snapshot) this.#restore(snapshot);
  }

  /** The whole state as plain data; `new PaperEngine({ ..., snapshot })` carries on from it. */
  snapshot(): PaperEngineSnapshotV3 {
    return {
      v: PAPER_ENGINE_SNAPSHOT_VERSION,
      seq: this.#seq,
      syncedTo: this.#syncedTo.toISOString(),
      orders: [...this.#orders.values()].map(copy),
      rejectCodes: [...this.#rejectCodes],
      positions: [...this.#positions.values()].map((p) => ({ ...p, book: { ...p.book } })),
      holdings: this.holdings() as EngineHolding[],
      holdingSales: this.holdingSales() as HoldingSale[],
      openingBalance: this.#funds.openingBalance,
      ledger: [...this.#funds.entries()],
      history: [...this.#history].map(([id, entries]) => [id, entries.map((e) => ({ ...e }))]),
      trailingStops: [...this.#stops.values()].map(copyStop),
      exitOrderIds: [...this.#exits],
      trailingStopRequestIds: [...this.#stopByRequestId],
    };
  }

  /**
   * The working set (v4); `new PaperEngine({ ..., snapshot })` carries on from it like a full
   * snapshot. It is apps/api's store format: the account keeps `seq`, so orders leave theirs out.
   * With `whole`, it keeps every order, trailing stop and ledger entry instead of only today's and
   * the live ones (a store taking over a whole account, such as the demo seed).
   */
  workingSet({ whole = false }: { whole?: boolean } = {}): PaperEngineWorkingSet {
    const syncedTo = this.#syncedTo;
    const day = toIstParts(syncedTo);
    const since = whole ? '' : fromIst(day.year, day.month, day.day, 0).toISOString();
    const kept = new Set<string>();
    for (const order of this.#orders.values()) {
      if (LIVE_STATUSES.has(order.status) || order.updatedAt >= since) kept.add(order.id);
    }
    const stops = [...this.#stops.values()].filter(
      (stop) => ACTIVE_STOP_STATUSES.has(stop.status) || stop.updatedAt >= since,
    );
    const keptStops = new Set(stops.map((stop) => stop.id));
    return {
      v: PAPER_ENGINE_WORKING_SET_VERSION,
      seq: this.#seq,
      syncedTo: syncedTo.toISOString(),
      orders: [...this.#orders.values()].filter((o) => kept.has(o.id)).map(withoutSeq),
      rejectCodes: [...this.#rejectCodes].filter(([id]) => kept.has(id)),
      positions: [...this.#positions.values()].map((p) => ({ ...p, book: { ...p.book } })),
      holdings: this.holdings() as EngineHolding[],
      holdingSales: this.holdingSales() as HoldingSale[],
      openingBalance: this.#funds.openingBalance,
      ledger: this.#funds.workingSet(since),
      history: [...this.#history]
        .filter(([id]) => kept.has(id))
        .map(([id, entries]) => [id, entries.map((e) => ({ ...e }))]),
      trailingStops: stops.map(copyStop),
      exitOrderIds: [...this.#exits].filter((id) => kept.has(id)),
      trailingStopRequestIds: [...this.#stopByRequestId].filter(([, id]) => keptStops.has(id)),
    };
  }

  /** The funds ledger: balances and the append-only entries. */
  get ledger(): FundsLedger {
    return this.#funds;
  }

  /** The sequence number of the last order or trailing-stop change (ADR 0012). */
  get seq(): number {
    return this.#seq;
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
    const attached = request.attachedTrailingStop;
    if (attached && !this.#trailingStopsEnabled) {
      return { ok: false, code: 'NOT_SUPPORTED', reason: TRAILING_STOPS_UNAVAILABLE, order: null };
    }

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
      marketHours: this.#marketHours,
      instrument,
      ltp: this.#ctx.ltp(draft.token),
      availableCash: this.#funds.available,
      sellableQty: this.#sellableQty(draft.token, null),
    });
    if (!checked.ok && isRequestError(checked.code)) {
      return { ok: false, code: checked.code, reason: checked.reason, order: null };
    }
    if (!instrument) throw new Error('unreachable: validation accepts only known instruments');

    const marketOpen = this.#marketOpen();
    if (request.validity === 'IOC' && checked.ok && !marketOpen) {
      return { ok: false, code: 'NOT_SUPPORTED', reason: IOC_NEEDS_OPEN_MARKET, order: null };
    }
    const direction: PositionDirection = draft.side === 'BUY' ? 'LONG' : 'SHORT';
    if (attached && checked.ok) {
      // Judged against the price the entry should fill near: the LTP, or the limit without one.
      const reference = this.#ctx.ltp(draft.token) ?? draft.price ?? 0;
      const check = validateTrailingStop({
        params: attached,
        direction,
        ltp: reference,
        hasPosition: true,
      });
      if (!check.ok) {
        return { ok: false, code: checkCode(check), reason: check.message, order: null };
      }
    }
    const status: OrderStatus = !checked.ok ? 'REJECTED' : marketOpen ? 'OPEN' : 'AMO';
    const order = this.#newOrder(draft, instrument, status, clientOrderId, request.validity);
    order.statusReason = checked.ok ? null : checked.reason;
    this.#orders.set(order.id, order);
    if (!checked.ok) this.#rejectCodes.set(order.id, checked.code);
    if (clientOrderId !== null) this.#byClientOrderId.set(clientOrderId, order.id);
    if (checked.ok && checked.blockAmount > 0) {
      this.#mustLedger(this.#funds.block(order.id, checked.blockAmount));
    }
    this.#record(order, 'PLACED', { note: order.statusReason });
    this.#emit(order);
    if (attached && checked.ok) this.#attachStop(order, attached, direction);
    if (order.status === 'OPEN') this.#match(order, true);
    if (order.status === 'OPEN' && order.validity === 'IOC') {
      this.#cancel(order, iocCancelReason(order.qty - order.filledQty, order.qty));
    }
    return this.#result(order);
  }

  /**
   * Changes qty, type or price of an AMO or OPEN order. The changed order is validated again
   * (with the cash it already has blocked) for the shares still to fill; on failure the order stays
   * as it was. A partly filled order's new quantity must exceed what has filled.
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
    const qty = request.qty ?? order.qty;
    if (order.filledQty > 0 && qty <= order.filledQty) {
      return {
        ok: false,
        code: 'INVALID_QTY',
        reason: `${String(order.filledQty)} shares have already filled. Enter a quantity above ${String(order.filledQty)}.`,
        order: copy(order),
      };
    }
    const draft: OrderDraft = {
      token: order.token,
      side: order.side,
      type,
      product: order.product,
      qty: qty - order.filledQty,
      price: request.price ?? (type === 'MARKET' ? null : order.price),
    };
    const checked = validateOrder(draft, {
      now: this.#now(),
      holidays: this.#holidays,
      marketHours: this.#marketHours,
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
    order.qty = qty;
    order.price = draft.price;
    order.updatedAt = this.#now().toISOString();
    this.#record(order, 'MODIFIED');
    this.#emit(order);
    if (order.status === 'OPEN') this.#match(order, true);
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
   * Protects an open position with a trailing stop (SPEC-TFC-1 §6). The stop starts from the LTP:
   * it trails at once, or waits for its activation price. It replaces the position's active stop.
   */
  placeTrailingStop(request: PlaceTrailingStopRequest): TrailingStopActionResult {
    this.sync();
    if (!this.#trailingStopsEnabled)
      return stopRefusal('NOT_SUPPORTED', TRAILING_STOPS_UNAVAILABLE);
    const requestId = request.clientRequestId ?? null;
    const existingId = requestId === null ? undefined : this.#stopByRequestId.get(requestId);
    const existing = existingId === undefined ? undefined : this.#stops.get(existingId);
    if (existing) return { ok: true, trailingStop: copyStop(existing) };

    const position = this.#positions.get(positionKey(request.token, request.product));
    const netQty = position?.book.netQty ?? 0;
    const direction: PositionDirection = netQty < 0 ? 'SHORT' : 'LONG';
    const params = paramsOf(request);
    const ltp = this.#ctx.ltp(request.token);
    if (!position || netQty === 0 || ltp === null) {
      if (!position || netQty === 0) {
        return stopRefusal('NO_POSITION', TRAILING_STOP_MESSAGES.noPosition);
      }
      return stopRefusal('NO_PRICE', noPriceReason(position.symbol));
    }
    const check = validateTrailingStop({ params, direction, ltp, hasPosition: true });
    if (!check.ok) return stopRefusal(checkCode(check), check.message);

    for (const other of this.#protectingStops(request.token, request.product)) {
      this.#cancelStop(other, STOP_REPLACED);
    }
    const stop = this.#newStop(position, request.product, direction, params, null);
    stop.status = 'ARMED';
    stop.protectedQty = Math.abs(netQty);
    this.#stops.set(stop.id, stop);
    if (requestId !== null) this.#stopByRequestId.set(requestId, stop.id);
    // A standalone stop starts from the LTP when it is placed (§6.3).
    applyStep(stop, stepTrailingStop(stopState(stop), ltp).state);
    this.#emitStop(stop);
    return { ok: true, trailingStop: copyStop(stop) };
  }

  /**
   * Changes an active trailing stop (SPEC-TFC-1 §6.5): a new trail, or a dragged stop price that
   * becomes a trail from the watermark now, plus the activation price and exit. The new stop is
   * the ratchet baseline, so a trail can widen. A triggered or finished stop cannot change.
   */
  modifyTrailingStop(id: string, request: ModifyTrailingStopRequest): TrailingStopActionResult {
    this.sync();
    const stop = this.#stops.get(id);
    if (!stop) return stopNotFound();
    if (!MODIFIABLE_STOP_STATUSES.has(stop.status)) {
      return stopRefusal(
        'ILLEGAL_TRANSITION',
        `This trailing stop is ${STOP_STATUS_WORDS[stop.status]} and can no longer be changed.`,
        stop,
      );
    }
    if (Object.values(request).every((value) => value === undefined)) {
      return stopRefusal('NOTHING_TO_CHANGE', 'Nothing to change.', stop);
    }
    const ltp = this.#ctx.ltp(stop.token);
    if (ltp === null) return stopRefusal('NO_PRICE', noPriceReason(stop.symbol), stop);

    const exitOrderType = request.exitOrderType ?? stop.exitOrderType;
    const exitLimitOffset =
      request.exitLimitOffset !== undefined
        ? request.exitLimitOffset
        : exitOrderType === 'MARKET'
          ? null
          : stop.exitLimitOffset;
    if ((exitOrderType === 'LIMIT') !== (exitLimitOffset !== null)) {
      return stopRefusal(
        'INVALID_LIMIT_OFFSET',
        exitOrderType === 'LIMIT'
          ? TRAILING_STOP_MESSAGES.limitOffsetRequired
          : TRAILING_STOP_MESSAGES.limitOffsetOnMarketExit,
        stop,
      );
    }
    const activationPrice =
      request.activationPrice !== undefined ? request.activationPrice : stop.activationPrice;

    let state: TrailingStopState = { ...stopState(stop), activationPrice };
    if (request.stopPrice !== undefined) {
      const dragged = validateStopPrice(request.stopPrice, ltp, stop.direction);
      if (!dragged.ok) return stopRefusal(checkCode(dragged), dragged.message, stop);
      if (state.watermarkPrice === null && state.activationPrice === null) {
        return stopRefusal(
          'INVALID_STOP_PRICE',
          'Set a trail instead: this trailing stop has no price to measure a stop from yet.',
          stop,
        );
      }
      state = applyStopModify(state, { stopPrice: request.stopPrice });
    } else if (request.trail !== undefined) {
      state = applyStopModify(state, { trail: request.trail });
    }
    const params: TrailingStopParams = {
      trail: state.trail,
      activationPrice,
      exitOrderType,
      exitLimitOffset,
    };
    const check = validateTrailingStop({
      params,
      direction: stop.direction,
      ltp,
      hasPosition: true,
    });
    if (!check.ok) return stopRefusal(checkCode(check), check.message, stop);
    if (state.status === 'TRAILING' && state.stopPrice !== null) {
      // A tighter trail measured from a watermark the price has fallen from could cross it.
      const live = validateStopPrice(state.stopPrice, ltp, stop.direction);
      if (!live.ok) return stopRefusal(checkCode(live), live.message, stop);
    }

    stop.trail = state.trail;
    stop.activationPrice = activationPrice;
    stop.exitOrderType = exitOrderType;
    stop.exitLimitOffset = exitLimitOffset;
    stop.watermarkPrice = state.watermarkPrice;
    stop.stopPrice = state.stopPrice;
    this.#touchStop(stop);
    this.#emitStop(stop);
    return { ok: true, trailingStop: copyStop(stop) };
  }

  /**
   * Cancels a trailing stop that is still active. A triggered stop with a working limit exit is
   * cancelled with its exit (SPEC-TFC-1 §6.4); the position stays open.
   */
  cancelTrailingStop(id: string): TrailingStopActionResult {
    this.sync();
    const stop = this.#stops.get(id);
    if (!stop) return stopNotFound();
    if (!ACTIVE_STOP_STATUSES.has(stop.status)) {
      return stopRefusal(
        'ILLEGAL_TRANSITION',
        `This trailing stop is ${STOP_STATUS_WORDS[stop.status]} and cannot be cancelled.`,
        stop,
      );
    }
    this.#cancelStop(stop, CANCELLED_BY_USER);
    return { ok: true, trailingStop: copyStop(stop) };
  }

  /**
   * Closes a position in one step (SPEC-TFC-1 §6.4): cancels its trailing stop and that stop's
   * exit, cancels the working orders in the instrument and product, and sends a reduce-only
   * MARKET exit for the open quantity. Flatten, Reverse and the ticket's Exit use it. Answers with
   * the exit order.
   */
  closePosition(token: InstrumentToken, product: ProductType): OrderActionResult {
    this.sync();
    const position = this.#positions.get(positionKey(token, product));
    const netQty = position?.book.netQty ?? 0;
    if (!position || netQty === 0) {
      return { ok: false, code: 'NO_POSITION', reason: NO_POSITION_TO_CLOSE, order: null };
    }
    for (const stop of this.#protectingStops(token, product)) {
      this.#cancelStop(stop, STOP_POSITION_CLOSED);
    }
    for (const order of this.#orders.values()) {
      if (order.token === token && order.product === product && LIVE_STATUSES.has(order.status)) {
        this.#cancel(order, CANCELLED_FOR_CLOSE);
      }
    }
    const draft: OrderDraft = {
      token,
      side: netQty > 0 ? 'SELL' : 'BUY',
      type: 'MARKET',
      product,
      qty: Math.abs(netQty),
      price: null,
    };
    const exit = this.#placeExit(draft, position, CLOSE_EXIT);
    if (exit.status === 'OPEN') this.#match(exit, true);
    return this.#result(exit);
  }

  getTrailingStop(id: string): TrailingStop | null {
    const stop = this.#stops.get(id);
    return stop ? copyStop(stop) : null;
  }

  /** Trailing stops in the order they were placed, optionally only one status. */
  trailingStops(status?: TrailingStopStatus): readonly TrailingStop[] {
    return [...this.#stops.values()]
      .filter((stop) => status === undefined || stop.status === status)
      .map(copyStop);
  }

  /**
   * Resets the paper account (T-155): cancels every AMO and OPEN order (each goes out as an order
   * update and releases its block), writes a `RESET` ledger entry that brings available cash back
   * to the opening balance, and clears orders, positions and holdings. The ledger keeps its
   * history (append-only). Returns the orders it cancelled.
   */
  reset(): readonly Order[] {
    this.sync();
    for (const stop of this.#stops.values()) {
      if (ACTIVE_STOP_STATUSES.has(stop.status)) this.#cancelStop(stop, CANCELLED_BY_RESET);
    }
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
    this.#cappedFillTick.clear();
    this.#stops.clear();
    this.#stopByRequestId.clear();
    this.#stopByEntry.clear();
    this.#exits.clear();
    return cancelled;
  }

  /**
   * Brings the engine up to the clock, matches every OPEN order against its current LTP, then
   * steps every armed and trailing stop (SPEC-TFC-1 §10.2). Returns the orders that changed (each
   * once, latest state), in the order they changed.
   */
  sync(): readonly Order[] {
    const changed: Order[] = [];
    this.#collectors.add(changed);
    try {
      this.#runSchedule(this.#ctx.now());
      for (const order of this.#orders.values()) {
        if (order.status === 'OPEN') this.#match(order);
      }
      for (const stop of this.#stops.values()) {
        if (stop.status !== 'ARMED' && stop.status !== 'TRAILING') continue;
        const ltp = this.#ctx.ltp(stop.token);
        if (ltp !== null) this.#stepStop(stop, ltp);
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
    if (
      snapshot.v !== PAPER_ENGINE_SNAPSHOT_VERSION &&
      snapshot.v !== PAPER_ENGINE_LEGACY_SNAPSHOT_VERSION &&
      snapshot.v !== PAPER_ENGINE_WORKING_SET_VERSION &&
      snapshot.v !== PAPER_ENGINE_LEGACY_WORKING_SET_VERSION
    ) {
      throw new Error(
        `Unsupported engine snapshot version ${String((snapshot as { v: unknown }).v)}`,
      );
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
    // Version 1 and the v2 working set predate trailing stops: they restore with none (§10.3).
    if (
      snapshot.v === PAPER_ENGINE_SNAPSHOT_VERSION ||
      snapshot.v === PAPER_ENGINE_WORKING_SET_VERSION
    ) {
      for (const raw of snapshot.trailingStops) {
        const stop = TrailingStopSchema.parse(raw);
        this.#stops.set(stop.id, stop);
        if (stop.status === 'PENDING_ENTRY' && stop.entryOrderId !== null) {
          this.#stopByEntry.set(stop.entryOrderId, stop.id);
        }
      }
      for (const id of snapshot.exitOrderIds) if (this.#orders.has(id)) this.#exits.add(id);
      for (const [requestId, stopId] of snapshot.trailingStopRequestIds) {
        if (this.#stops.has(stopId)) this.#stopByRequestId.set(requestId, stopId);
      }
    }
    // `seq` never goes back: at least the newest change any record carries.
    let seq =
      snapshot.v === PAPER_ENGINE_SNAPSHOT_VERSION ||
      snapshot.v === PAPER_ENGINE_WORKING_SET_VERSION
        ? snapshot.seq
        : 0;
    for (const order of this.#orders.values()) seq = Math.max(seq, order.seq ?? 0);
    for (const stop of this.#stops.values()) seq = Math.max(seq, stop.seq);
    if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError('Invalid snapshot seq');
    this.#seq = seq;
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
      const exit = this.#exits.has(order.id);
      const checked = validateOrder(order, {
        now: this.#now(),
        holidays: this.#holidays,
        marketHours: this.#marketHours,
        instrument: this.#instruments.getInstrument(order.token),
        ltp: this.#ctx.ltp(order.token),
        availableCash: exit
          ? Number.MAX_SAFE_INTEGER
          : this.#funds.available + this.#funds.blockedFor(order.id),
        sellableQty: exit ? Number.MAX_SAFE_INTEGER : this.#sellableQty(order.token, order.id),
      });
      order.updatedAt = this.#now().toISOString();
      if (!checked.ok) {
        this.#funds.release(order.id);
        order.status = transitionOrder(order.status, 'REJECT');
        order.statusReason = checked.reason;
        this.#rejectCodes.set(order.id, checked.code);
        this.#record(order, 'REJECTED', { note: checked.reason });
        this.#emit(order);
        this.#entryClosed(order);
        continue;
      }
      if (!exit) this.#reblock(order.id, checked.blockAmount);
      order.status = transitionOrder(order.status, 'RELEASE');
      this.#record(order, 'RELEASED');
      this.#emit(order);
      this.#match(order, true);
    }
  }
  /**
   * 15:20 IST (T-130): expires Intraday trailing stops (SPEC-TFC-1 §6.4), cancels OPEN intraday
   * orders, then closes every open intraday position with a MARKET order at the LTP (at the
   * position's average price, on the tick, if there is no LTP). The buy-back of a short always
   * settles, even into a debit balance.
   */
  #squareOffIntraday(): void {
    this.#expireStops('INTRADAY');
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
   * 15:30 IST (T-130): expires Delivery trailing stops, cancels every OPEN order (day orders do
   * not carry over), moves today's delivery buys into holdings at their cost, and starts a fresh
   * day of positions. AMOs placed after the close wait for the next session.
   */
  #closeDay(): void {
    this.#squareOffIntraday();
    this.#expireStops('DELIVERY');
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
    if (this.#marketHours === 'alwaysOpen') return true;
    return getMarketStatus({ now: () => this.#now() }, this.#holidays).state === 'open';
  }

  #newOrder(
    draft: OrderDraft,
    names: { symbol: TradingSymbol; exchange: Exchange },
    status: OrderStatus,
    clientOrderId: string | null,
    validity: OrderValidity = 'DAY',
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
      validity,
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
    this.#cappedFillTick.delete(order.id);
    order.status = transitionOrder(order.status, 'CANCEL');
    order.statusReason = reason;
    order.updatedAt = this.#now().toISOString();
    this.#record(order, 'CANCELLED', { note: reason });
    this.#emit(order);
    this.#entryClosed(order);
    // A triggered stop whose exit is cancelled some other way (the user, the square-off) ends too.
    const stop = this.#stopOfExit(order.id);
    if (stop?.status === 'TRIGGERED') this.#cancelStop(stop, reason);
  }

  /** Moves the order's block to `amount`: blocks more or releases the difference. */
  #reblock(orderId: string, amount: number): void {
    const held = this.#funds.blockedFor(orderId);
    if (amount > held) this.#mustLedger(this.#funds.block(orderId, amount - held));
    else if (amount < held) this.#mustLedger(this.#funds.release(orderId, held - amount));
  }

  /**
   * Matches an OPEN order against its LTP. `onArrival` is true when the order has just been
   * placed, modified or released, so a marketable limit fills at the better price. A capped LIMIT
   * order fills at most once per tick of its instrument.
   */
  #match(order: StoredOrder, onArrival = false): void {
    const ltp = this.#ctx.ltp(order.token);
    if (ltp === null) return;
    const cap = order.type === 'LIMIT' ? this.#fillCap(order.token) : null;
    const tick = cap === null ? null : this.#ctx.tick(order.token);
    if (tick !== null && this.#cappedFillTick.get(order.id) === tick) return;
    const fill = matchFill(order, ltp, { maxQty: cap, onArrival });
    if (!fill) return;
    if (tick !== null) this.#cappedFillTick.set(order.id, tick);
    this.#execute(order, fill.qty, fill.price);
  }

  /**
   * Settles a fill of `qty` shares and books it into positions and holdings. A BUY releases the
   * block in proportion to the shares filled, and all of what is left on the last fill. The order
   * stays OPEN until its last share fills.
   */
  #execute(order: StoredOrder, fillQty: number, price: number, squareOff = false): void {
    const exit = this.#exits.has(order.id);
    let qty = fillQty;
    if (exit) {
      // Reduce-only (SPEC-TFC-1 §6.4): an exit never takes the position past flat, even when a
      // manual exit filled on the same tick.
      const closable = this.#closableQty(order);
      if (closable === 0) {
        this.#cancel(order, EXIT_NOT_NEEDED);
        return;
      }
      qty = Math.min(qty, closable);
    }
    const value = qty * price;
    const remaining = order.qty - order.filledQty;
    const last = qty === remaining;
    if (order.side === 'SELL') this.#mustLedger(this.#funds.settleSell(order.id, value));
    else if (squareOff || exit) this.#mustLedger(this.#funds.settleForcedBuy(order.id, value));
    else {
      const release = last
        ? undefined
        : mulDivRound(this.#funds.blockedFor(order.id), qty, remaining);
      this.#mustLedger(this.#funds.settleBuy(order.id, value, release));
    }

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

    order.status = transitionOrder(order.status, last ? 'FILL' : 'PARTIAL_FILL');
    // Averaged from the exact value of every fill, so rounding never accumulates.
    order.avgFillPrice = mulDivRound(this.#filledValue(order.id) + value, 1, order.filledQty + qty);
    order.filledQty += qty;
    order.updatedAt = this.#now().toISOString();
    if (last) this.#cappedFillTick.delete(order.id);
    this.#record(order, last ? 'EXECUTED' : 'PARTIALLY_EXECUTED', {
      fillPrice: price,
      fillQty: qty,
    });
    this.#emit(order);
    this.#afterFill(order, price);
  }

  /** The value of the order's fills so far, from its history. */
  #filledValue(orderId: string): number {
    let total = 0;
    for (const entry of this.#history.get(orderId) ?? []) {
      if (entry.fillPrice !== null) total += entry.fillPrice * (entry.fillQty ?? 0);
    }
    return total;
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
  #record(order: StoredOrder, event: OrderHistoryEvent, extra: HistoryExtra = {}): void {
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
    this.#seq += 1;
    order.seq = this.#seq;
    const snapshot = copy(order);
    for (const collector of this.#collectors) collector.push(snapshot);
    this.#onOrderUpdate?.(snapshot);
  }

  // ---- Trailing stops (SPEC-TFC-1 §6) -----------------------------------------------------------

  #newStop(
    names: { token: InstrumentToken; symbol: TradingSymbol; exchange: Exchange },
    product: ProductType,
    direction: PositionDirection,
    params: TrailingStopParams,
    entryOrderId: string | null,
  ): StoredStop {
    const now = this.#now().toISOString();
    return {
      id: this.#ctx.nextId(),
      token: names.token,
      symbol: names.symbol,
      exchange: names.exchange,
      product,
      direction,
      trail: { ...params.trail },
      activationPrice: params.activationPrice,
      exitOrderType: params.exitOrderType,
      exitLimitOffset: params.exitLimitOffset,
      status: 'PENDING_ENTRY',
      statusReason: null,
      watermarkPrice: null,
      stopPrice: null,
      protectedQty: 0,
      entryOrderId,
      exitOrderId: null,
      seq: this.#seq,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** A stop attached to a new entry order waits for the entry's first fill (PENDING_ENTRY). */
  #attachStop(entry: StoredOrder, params: TrailingStopParams, direction: PositionDirection): void {
    const stop = this.#newStop(entry, entry.product, direction, paramsOf(params), entry.id);
    this.#stops.set(stop.id, stop);
    this.#stopByEntry.set(entry.id, stop.id);
    this.#emitStop(stop);
  }

  /** The stops protecting the position (at most one, by construction). */
  #protectingStops(token: InstrumentToken, product: ProductType): StoredStop[] {
    return [...this.#stops.values()].filter(
      (stop) =>
        stop.token === token &&
        stop.product === product &&
        PROTECTING_STOP_STATUSES.has(stop.status),
    );
  }

  /** One tick for one stop; a trigger places its exit (SPEC-TFC-1 §6.3). */
  #stepStop(stop: StoredStop, ltp: number): void {
    const { state, triggered } = stepTrailingStop(stopState(stop), ltp);
    if (!applyStep(stop, state)) return;
    this.#touchStop(stop);
    if (triggered) this.#triggerStop(stop);
    else this.#emitStop(stop);
  }

  /**
   * TRIGGERED: places one reduce-only exit for the protected quantity, MARKET or LIMIT at the
   * stop less (long) or plus (short) the offset. A refused exit leaves the stop REJECTED with the
   * reason, and the position unprotected (SPEC-TFC-1 §6.4).
   */
  #triggerStop(stop: StoredStop): void {
    const stopPrice = stop.stopPrice ?? 0;
    const offset = stop.exitLimitOffset ?? 0;
    const draft: OrderDraft = {
      token: stop.token,
      side: stop.direction === 'LONG' ? 'SELL' : 'BUY',
      type: stop.exitOrderType,
      product: stop.product,
      qty: stop.protectedQty,
      price:
        stop.exitOrderType === 'LIMIT'
          ? stop.direction === 'LONG'
            ? stopPrice - offset
            : stopPrice + offset
          : null,
    };
    const exit = this.#placeExit(draft, stop, stopExitReason(stopPrice));
    stop.exitOrderId = exit.id;
    if (exit.status === 'REJECTED') {
      this.#finishStop(stop, 'REJECTED', exit.statusReason);
      return;
    }
    this.#emitStop(stop);
    if (exit.status === 'OPEN') this.#match(exit, true);
  }

  /**
   * Stores an engine-placed exit. It skips the cash and holdings checks: it is reduce-only, so it
   * can only close shares the position holds, and a buy-back settles like the square-off. The
   * other rules (circuit band, intraday hours, a price) still apply; a failure stores it REJECTED.
   */
  #placeExit(
    draft: OrderDraft,
    names: { symbol: TradingSymbol; exchange: Exchange },
    note: string,
  ): StoredOrder {
    const checked: ValidationResult =
      draft.price !== null && draft.price < TICK_SIZE_PAISE
        ? {
            ok: false,
            code: 'PRICE_OFF_TICK',
            reason: TRAILING_STOP_MESSAGES.limitOffsetTooLarge,
          }
        : validateOrder(draft, {
            now: this.#now(),
            holidays: this.#holidays,
            marketHours: this.#marketHours,
            instrument: this.#instruments.getInstrument(draft.token),
            ltp: this.#ctx.ltp(draft.token),
            availableCash: Number.MAX_SAFE_INTEGER,
            sellableQty: Number.MAX_SAFE_INTEGER,
          });
    const status: OrderStatus = !checked.ok ? 'REJECTED' : this.#marketOpen() ? 'OPEN' : 'AMO';
    const order = this.#newOrder(draft, names, status, null);
    order.statusReason = checked.ok ? note : checked.reason;
    this.#orders.set(order.id, order);
    this.#exits.add(order.id);
    if (!checked.ok) this.#rejectCodes.set(order.id, checked.code);
    this.#record(order, 'PLACED', { note: order.statusReason });
    this.#emit(order);
    return order;
  }

  /** Shares a reduce-only exit may still close: what the position holds on the other side. */
  #closableQty(order: StoredOrder): number {
    const netQty = this.#positions.get(positionKey(order.token, order.product))?.book.netQty ?? 0;
    return order.side === 'SELL' ? Math.max(0, netQty) : Math.max(0, -netQty);
  }

  /**
   * After every fill (SPEC-TFC-1 §6.4): an entry's attached stop arms on the first fill that
   * opens its position, replacing the position's stop; every stop on the position protects its
   * open quantity, or ends when the position closes or flips; exits the position no longer needs
   * are cancelled.
   */
  #afterFill(order: StoredOrder, price: number): void {
    const { token, product } = order;
    const netQty = this.#positions.get(positionKey(token, product))?.book.netQty ?? 0;
    const pendingId = this.#stopByEntry.get(order.id);
    const pending = pendingId === undefined ? undefined : this.#stops.get(pendingId);
    if (
      pending?.status === 'PENDING_ENTRY' &&
      netQty !== 0 &&
      directionOf(netQty) === pending.direction
    ) {
      this.#stopByEntry.delete(order.id);
      for (const other of this.#protectingStops(token, product)) {
        this.#cancelStop(other, STOP_REPLACED);
      }
      pending.protectedQty = Math.abs(netQty);
      // An attached stop starts from the entry's first fill price (§6.3).
      applyStep(pending, stepTrailingStop({ ...stopState(pending), status: 'ARMED' }, price).state);
      this.#touchStop(pending);
      this.#emitStop(pending);
    }
    for (const stop of this.#protectingStops(token, product)) this.#followPosition(stop, netQty);
    for (const id of this.#exits) {
      const exit = this.#orders.get(id);
      if (
        exit?.token === token &&
        exit.product === product &&
        LIVE_STATUSES.has(exit.status) &&
        this.#closableQty(exit) === 0
      ) {
        this.#cancel(exit, EXIT_NOT_NEEDED);
      }
    }
    if (pending?.status === 'PENDING_ENTRY' && order.status === 'EXECUTED') {
      this.#entryClosed(order);
    }
    if (product === 'DELIVERY' && order.side === 'SELL' && this.#exits.has(order.id)) {
      this.#coverDeliverySells(token);
    }
  }

  /**
   * An exit skips the holdings check, so after it sells, the user's own delivery SELL orders may
   * cover more shares than are left. Those that no longer fit are cancelled, oldest kept first, so
   * no fill can sell shares the account does not hold.
   */
  #coverDeliverySells(token: InstrumentToken): void {
    let sellable =
      (this.#holdings.get(token)?.qty ?? 0) +
      Math.max(0, this.#positions.get(positionKey(token, 'DELIVERY'))?.book.netQty ?? 0);
    for (const order of this.#orders.values()) {
      if (
        order.token !== token ||
        order.side !== 'SELL' ||
        order.product !== 'DELIVERY' ||
        !LIVE_STATUSES.has(order.status) ||
        this.#exits.has(order.id)
      ) {
        continue;
      }
      const remaining = order.qty - order.filledQty;
      if (remaining <= sellable) sellable -= remaining;
      else this.#cancel(order, SELL_UNCOVERED);
    }
  }

  /** Keeps a stop on its position: the open quantity, EXECUTED by its exit, or CANCELLED. */
  #followPosition(stop: StoredStop, netQty: number): void {
    const exit = stop.exitOrderId === null ? undefined : this.#orders.get(stop.exitOrderId);
    const open = netQty !== 0 && directionOf(netQty) === stop.direction;
    if (open && exit?.status !== 'EXECUTED') {
      if (stop.protectedQty === Math.abs(netQty)) return;
      stop.protectedQty = Math.abs(netQty);
      this.#touchStop(stop);
      this.#emitStop(stop);
      return;
    }
    if (exit && exit.filledQty > 0) {
      // The exit closed the position (a manual exit may have taken part of it).
      stop.protectedQty = open ? Math.abs(netQty) : 0;
      this.#finishStop(stop, 'EXECUTED', null);
      if (LIVE_STATUSES.has(exit.status)) this.#cancel(exit, EXIT_NOT_NEEDED);
      return;
    }
    stop.protectedQty = 0;
    this.#cancelStop(stop, STOP_POSITION_CLOSED);
  }

  /** An entry order ended (cancelled, rejected, or filled without opening the position). */
  #entryClosed(order: StoredOrder): void {
    const stopId = this.#stopByEntry.get(order.id);
    if (stopId === undefined) return;
    this.#stopByEntry.delete(order.id);
    const stop = this.#stops.get(stopId);
    if (stop?.status !== 'PENDING_ENTRY') return;
    const reason =
      order.status === 'REJECTED'
        ? STOP_ENTRY_REJECTED
        : order.filledQty === 0
          ? STOP_ENTRY_CANCELLED
          : STOP_NOTHING_TO_PROTECT;
    this.#cancelStop(stop, reason);
  }

  #stopOfExit(orderId: string): StoredStop | undefined {
    if (!this.#exits.has(orderId)) return undefined;
    for (const stop of this.#stops.values()) if (stop.exitOrderId === orderId) return stop;
    return undefined;
  }

  /** CANCELLED with the reason; a working exit is cancelled with it, in the same step. */
  #cancelStop(stop: StoredStop, reason: string): void {
    if (!ACTIVE_STOP_STATUSES.has(stop.status)) return;
    stop.status = 'CANCELLED';
    stop.statusReason = reason;
    this.#touchStop(stop);
    if (stop.entryOrderId !== null) this.#stopByEntry.delete(stop.entryOrderId);
    const exit = stop.exitOrderId === null ? undefined : this.#orders.get(stop.exitOrderId);
    if (exit && LIVE_STATUSES.has(exit.status)) this.#cancel(exit, EXIT_CANCELLED_WITH_STOP);
    this.#emitStop(stop);
  }

  #finishStop(stop: StoredStop, status: 'EXECUTED' | 'REJECTED', reason: string | null): void {
    stop.status = status;
    stop.statusReason = reason;
    this.#touchStop(stop);
    this.#emitStop(stop);
  }

  /** Day validity (SPEC-TFC-1 §6.4): Intraday stops end at 15:20, Delivery ones at 15:30. */
  #expireStops(product: ProductType): void {
    for (const stop of this.#stops.values()) {
      if (stop.product === product && ACTIVE_STOP_STATUSES.has(stop.status)) {
        this.#cancelStop(stop, STOP_EXPIRED);
      }
    }
  }

  #touchStop(stop: StoredStop): void {
    stop.updatedAt = this.#now().toISOString();
  }

  #emitStop(stop: StoredStop): void {
    this.#seq += 1;
    stop.seq = this.#seq;
    this.#onTrailingStopUpdate?.(copyStop(stop));
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

type HistoryExtra = { fillPrice?: number; fillQty?: number; note?: string | null };

function historyEntry(
  order: Order,
  event: OrderHistoryEvent,
  at: string,
  extra: HistoryExtra = {},
): OrderHistoryEntry {
  return {
    event,
    status: order.status,
    at,
    qty: order.qty,
    type: order.type,
    price: order.price,
    fillPrice: extra.fillPrice ?? null,
    ...(extra.fillQty === undefined ? {} : { fillQty: extra.fillQty }),
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

/** The ledger part of a snapshot: whole (v1) or a carried balance plus entries (v2). */
function ledgerOptions(snapshot: PaperEngineSnapshot): FundsLedgerOptions {
  if (
    snapshot.v === PAPER_ENGINE_WORKING_SET_VERSION ||
    snapshot.v === PAPER_ENGINE_LEGACY_WORKING_SET_VERSION
  ) {
    return {
      openingBalance: snapshot.openingBalance,
      entries: snapshot.ledger.entries,
      carried: snapshot.ledger.carried,
    };
  }
  return { openingBalance: snapshot.openingBalance, entries: snapshot.ledger };
}

function positionKey(token: InstrumentToken, product: ProductType): string {
  return `${String(token)}:${product}`;
}

function directionOf(netQty: number): PositionDirection {
  return netQty > 0 ? 'LONG' : 'SHORT';
}

/** The part of a stop the per-tick rules read (`trailingStop.ts`). */
function stopState(stop: StoredStop): TrailingStopState {
  return {
    status: stop.status,
    direction: stop.direction,
    trail: stop.trail,
    activationPrice: stop.activationPrice,
    watermarkPrice: stop.watermarkPrice,
    stopPrice: stop.stopPrice,
  };
}

/** Writes a step's result into the stop; false when nothing moved. */
function applyStep(stop: StoredStop, state: TrailingStopState): boolean {
  if (
    stop.status === state.status &&
    stop.watermarkPrice === state.watermarkPrice &&
    stop.stopPrice === state.stopPrice
  ) {
    return false;
  }
  stop.status = state.status;
  stop.watermarkPrice = state.watermarkPrice;
  stop.stopPrice = state.stopPrice;
  return true;
}

/** Request params with the contract defaults filled in. */
function paramsOf(params: {
  trail: TrailingStopParams['trail'];
  activationPrice?: number | null | undefined;
  exitOrderType?: TrailingStopParams['exitOrderType'] | undefined;
  exitLimitOffset?: number | null | undefined;
}): TrailingStopParams {
  return {
    trail: params.trail,
    activationPrice: params.activationPrice ?? null,
    exitOrderType: params.exitOrderType ?? 'MARKET',
    exitLimitOffset: params.exitLimitOffset ?? null,
  };
}

/** A detached copy, so callers can't change engine state. */
function copyStop(stop: StoredStop): TrailingStop {
  return { ...stop, trail: { ...stop.trail } };
}

/** An order as the working set keeps it: without `seq`. */
function withoutSeq(order: StoredOrder): Order {
  const { seq, ...rest } = order;
  void seq;
  return rest;
}

const CHECK_CODES: Record<
  Extract<TrailingStopCheck, { ok: false }>['field'],
  TrailingStopCheckCode
> = {
  position: 'NO_POSITION',
  trail: 'INVALID_TRAIL',
  stopPrice: 'INVALID_STOP_PRICE',
  exitLimitOffset: 'INVALID_LIMIT_OFFSET',
};

function checkCode(check: Extract<TrailingStopCheck, { ok: false }>): TrailingStopCheckCode {
  return CHECK_CODES[check.field];
}

function stopRefusal(
  code: TrailingStopActionErrorCode,
  reason: string,
  stop?: StoredStop,
): TrailingStopActionResult {
  return { ok: false, code, reason, trailingStop: stop ? copyStop(stop) : null };
}

function stopNotFound(): TrailingStopActionResult {
  return stopRefusal('TRAILING_STOP_NOT_FOUND', 'This trailing stop was not found.');
}

function noPriceReason(symbol: string): string {
  return `There is no market price for ${symbol} yet. Try again shortly.`;
}
