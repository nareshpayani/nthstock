import type {
  AccountState,
  Depth,
  Exchange,
  FundsSummary,
  Order,
  Position,
  TrailingStop,
  WsAccountDelta,
} from '@nthstock/contracts';
import { animationFrameScheduler, type FrameScheduler, type QuoteStore } from './quoteStore.js';
import { globalTimers, type Timers, type WsClient, type WsStatus } from './wsClient.js';

/**
 * The trading store (ADR 0012, SPEC-TFC-1 §10.1): the signed-in user's orders, positions,
 * trailing stops, funds and the focused instrument's depth, kept outside React beside the quote
 * store. It loads `GET /v1/account/state`, then applies each `accountDelta` frame in one commit on
 * the same animation frame as that frame's quotes, so no surface shows a fill another has not.
 *
 * Sequencing: every engine change has a `seq`, and a frame's `seq` is its newest change. A frame
 * older than the store is stale (its quotes and depth still apply). A newer frame that does not
 * carry its own newest change means frames were lost, and so does a socket that reopened: the
 * store re-reads the account state, holding frames that arrive meanwhile and applying the newer
 * ones on top. Each order and stop is replaced only by a copy at the same or a later `seq`.
 *
 * Pending intents: a place, modify or cancel the user started and the backend has not answered
 * yet. Screens show them (a dragged price, a disabled button). Each settles on its response, on a
 * frame that carries its order (placements, by `clientOrderId`), or on a fill that makes it moot.
 * After 5 seconds with none, the store drops it, re-reads the account and tells the
 * `onIntentTimeout` listeners, so the app can tell the user.
 */

/** Where frames come from: the app's WebSocket client in the app, a fake in tests. */
export type TradingSource = {
  onAccountDelta(listener: (delta: WsAccountDelta) => void): () => void;
  /** Names the instrument on screen; the first call switches the socket to `accountDelta`. */
  focus(symbol: string | null, exchange?: Exchange): void;
  /** A reopen after a drop means frames may have been lost. */
  onStatus?(listener: (status: WsStatus) => void): () => void;
};

export type TradingStatus = 'idle' | 'loading' | 'ready' | 'error';

export type IntentKind =
  | 'place'
  | 'modify'
  | 'cancel'
  | 'placeTrailingStop'
  | 'modifyTrailingStop'
  | 'cancelTrailingStop'
  | 'closePosition';

export type PendingIntent = {
  readonly key: string;
  readonly kind: IntentKind;
  readonly orderId?: string;
  readonly trailingStopId?: string;
  /** Placements: the idempotency key the order will carry. */
  readonly clientOrderId?: string;
  /** What screens show meanwhile, e.g. the price a line was dragged to (paise). */
  readonly price?: number;
  readonly startedAt: number;
};

export type NewIntent = Omit<PendingIntent, 'key' | 'startedAt'>;

export type IntentHandle = {
  readonly key: string;
  /** The backend answered: applies the entity it returned and settles the intent. */
  ack(entity?: Order | TrailingStop | null): void;
  /** The backend refused, or the request failed: settles the intent with nothing applied. */
  fail(): void;
};

/** One committed state. A new object on every commit, the same one until the next. */
export type TradingState = {
  readonly status: TradingStatus;
  /** The engine `seq` the store has applied up to. */
  readonly seq: number;
  /** Newest first. */
  readonly orders: readonly Order[];
  readonly positions: readonly Position[];
  /** Newest first. */
  readonly trailingStops: readonly TrailingStop[];
  readonly funds: FundsSummary | null;
  /** Depth of the focused instrument, from the latest frame. */
  readonly depth: Depth | null;
  readonly focus: { readonly symbol: string; readonly exchange: Exchange } | null;
  readonly pending: readonly PendingIntent[];
};

/** What one commit changed, for writing through to other caches (TanStack Query in the app). */
export type TradingCommit = {
  readonly state: TradingState;
  /** True when the commit replaced everything from a fresh account state. */
  readonly reloaded: boolean;
  readonly orders: readonly Order[];
  readonly trailingStops: readonly TrailingStop[];
  readonly positionsChanged: boolean;
  readonly fundsChanged: boolean;
};

export type TradingStoreOptions = {
  source?: TradingSource;
  /** `GET /v1/account/state`. */
  loadState: () => Promise<AccountState>;
  /**
   * The quote store fed by the same socket (the WS client hands it each frame's quotes before the
   * frame reaches this store); its pending quotes commit in the same frame as the trading changes.
   */
  quoteStore?: Pick<QuoteStore, 'flush'>;
  schedule?: FrameScheduler;
  timers?: Pick<Timers, 'setTimeout' | 'clearTimeout'>;
  now?: () => number;
  intentTimeoutMs?: number;
  onCommit?: (commit: TradingCommit) => void;
};

export type TradingStore = {
  getState(): TradingState;
  /** Called after every commit. */
  subscribe(listener: () => void): () => void;
  /** Loads the account (sign-in, or the app starting signed in) and starts taking frames. */
  start(): Promise<void>;
  /** Sign-out: forgets everything, pending intents included, and ignores frames until `start`. */
  clear(): void;
  /** Re-reads the account state now (resume, a timeout, a lost frame). */
  resync(): Promise<void>;
  /** The instrument on screen: its depth comes with each frame. */
  focus(symbol: string | null, exchange?: Exchange): void;
  /** Applies a frame (the source calls this; tests may too). */
  ingest(delta: WsAccountDelta): void;
  /** Applies an order or stop a command response returned. */
  applyOrder(order: Order): void;
  applyTrailingStop(stop: TrailingStop): void;
  begin(intent: NewIntent): IntentHandle;
  /** An intent went 5 seconds without an answer (the store has dropped it and is re-reading). */
  onIntentTimeout(listener: (intent: PendingIntent) => void): () => void;
  /** Commits now; the scheduler calls this. */
  flush(): void;
  dispose(): void;
};

export const INTENT_TIMEOUT_MS = 5_000;

const TERMINAL_ORDER: ReadonlySet<Order['status']> = new Set(['EXECUTED', 'CANCELLED', 'REJECTED']);

const positionKey = (position: Pick<Position, 'token' | 'product'>) =>
  `${String(position.token)}:${position.product}`;

/** Newest first, by creation time then id, so the order is stable. */
const newestFirst = <T extends { id: string }>(items: Iterable<T>, at: (item: T) => string): T[] =>
  [...items].sort((a, b) =>
    at(a) === at(b) ? b.id.localeCompare(a.id) : at(b).localeCompare(at(a)),
  );

const EMPTY: TradingState = {
  status: 'idle',
  seq: 0,
  orders: [],
  positions: [],
  trailingStops: [],
  funds: null,
  depth: null,
  focus: null,
  pending: [],
};

export function createTradingStore(options: TradingStoreOptions): TradingStore {
  const schedule = options.schedule ?? animationFrameScheduler;
  const timers = options.timers ?? globalTimers;
  const now = options.now ?? Date.now;
  const intentTimeoutMs = options.intentTimeoutMs ?? INTENT_TIMEOUT_MS;
  const { source, quoteStore } = options;

  const listeners = new Set<() => void>();
  const timeoutListeners = new Set<(intent: PendingIntent) => void>();
  const orders = new Map<string, Order>();
  const stops = new Map<string, TrailingStop>();
  const positions = new Map<string, Position>();
  const intents = new Map<string, { intent: PendingIntent; timer: unknown }>();
  let funds: FundsSummary | null = null;
  let depth: Depth | null = null;
  let focus: TradingState['focus'] = null;
  let status: TradingStatus = 'idle';
  let seq = 0;
  let state = EMPTY;

  // What changed since the last commit.
  const changedOrders = new Map<string, Order>();
  const changedStops = new Map<string, TrailingStop>();
  let positionsChanged = false;
  let fundsChanged = false;
  let reloaded = false;
  let dirty = false;
  let flushQueued = false;

  /** Frames held while the account state loads; applied on top of it. */
  let held: WsAccountDelta[] | null = null;
  let loading: Promise<void> | null = null;
  /** Bumped by `clear`, so a load that started before a sign-out is ignored. */
  let epoch = 0;
  let disposed = false;
  let intentCount = 0;

  const markDirty = () => {
    dirty = true;
    if (flushQueued || disposed) return;
    flushQueued = true;
    schedule(flush);
  };

  function flush() {
    flushQueued = false;
    // The frame's quotes commit in this same frame.
    quoteStore?.flush();
    if (!dirty) return;
    dirty = false;
    state = {
      status,
      seq,
      orders: newestFirst(orders.values(), (order) => order.placedAt),
      positions: [...positions.values()],
      trailingStops: newestFirst(stops.values(), (stop) => stop.createdAt),
      funds,
      depth,
      focus,
      pending: [...intents.values()].map((entry) => entry.intent),
    };
    const commit: TradingCommit = {
      state,
      reloaded,
      orders: [...changedOrders.values()],
      trailingStops: [...changedStops.values()],
      positionsChanged,
      fundsChanged,
    };
    changedOrders.clear();
    changedStops.clear();
    positionsChanged = false;
    fundsChanged = false;
    reloaded = false;
    options.onCommit?.(commit);
    for (const listener of [...listeners]) listener();
  }

  const settle = (key: string) => {
    const entry = intents.get(key);
    if (!entry) return;
    timers.clearTimeout(entry.timer);
    intents.delete(key);
    markDirty();
  };

  /** Settles the intents a changed order answers: its placement, or a fill that makes them moot. */
  const settleFor = (order: Order) => {
    for (const [key, { intent }] of intents) {
      const placed =
        intent.kind === 'place' &&
        intent.clientOrderId !== undefined &&
        intent.clientOrderId === order.clientOrderId;
      const moot =
        (intent.kind === 'modify' || intent.kind === 'cancel') &&
        intent.orderId === order.id &&
        TERMINAL_ORDER.has(order.status);
      if (placed || moot) settle(key);
    }
  };

  const putOrder = (order: Order) => {
    const existing = orders.get(order.id);
    if (existing && (existing.seq ?? 0) > (order.seq ?? 0)) return;
    orders.set(order.id, order);
    changedOrders.set(order.id, order);
    settleFor(order);
    markDirty();
  };

  const putStop = (stop: TrailingStop) => {
    const existing = stops.get(stop.id);
    if (existing && existing.seq > stop.seq) return;
    stops.set(stop.id, stop);
    changedStops.set(stop.id, stop);
    markDirty();
  };

  const putPositions = (list: readonly Position[]) => {
    if (list.length === 0) return;
    for (const position of list) positions.set(positionKey(position), position);
    positionsChanged = true;
    markDirty();
  };

  const replace = (snapshot: AccountState) => {
    orders.clear();
    stops.clear();
    positions.clear();
    for (const order of snapshot.orders) orders.set(order.id, order);
    for (const stop of snapshot.trailingStops) stops.set(stop.id, stop);
    for (const position of snapshot.positions) positions.set(positionKey(position), position);
    funds = snapshot.funds;
    seq = snapshot.seq;
    for (const order of snapshot.orders) settleFor(order);
    reloaded = true;
    positionsChanged = true;
    fundsChanged = true;
    markDirty();
  };

  /** True when a newer frame carries its own newest change (so nothing between was lost). */
  const carriesItsSeq = (delta: WsAccountDelta) =>
    delta.orders.some((order) => order.seq === delta.seq) ||
    delta.trailingStops.some((stop) => stop.seq === delta.seq);

  const applyFrame = (delta: WsAccountDelta) => {
    if (delta.seq < seq) return; // Stale: an older frame, or one the snapshot already covers.
    if (delta.seq > seq && !carriesItsSeq(delta)) {
      void resync();
      return;
    }
    for (const order of delta.orders) putOrder(order);
    for (const stop of delta.trailingStops) putStop(stop);
    putPositions(delta.positions);
    if (delta.funds) {
      funds = delta.funds;
      fundsChanged = true;
    }
    seq = Math.max(seq, delta.seq);
    markDirty();
  };

  const ingest = (delta: WsAccountDelta) => {
    if (disposed) return;
    if (
      delta.depth &&
      focus?.symbol === delta.depth.symbol &&
      focus.exchange === delta.depth.exchange
    ) {
      depth = delta.depth;
      markDirty();
    }
    if (status === 'idle') return; // Signed out: no account to apply it to.
    if (held) {
      held.push(delta);
      return;
    }
    if (status !== 'ready') return;
    applyFrame(delta);
  };

  function resync(): Promise<void> {
    if (disposed || status === 'idle') return Promise.resolve();
    if (loading) return loading;
    const mine = epoch;
    held = [];
    loading = options
      .loadState()
      .then(
        (snapshot) => {
          if (mine !== epoch) return;
          replace(snapshot);
          status = 'ready';
          const frames = held ?? [];
          held = null;
          for (const frame of frames) applyFrame(frame);
        },
        () => {
          if (mine !== epoch) return;
          held = null;
          // A first load that failed leaves the store in error; a later failed re-read keeps
          // what it has, and the next lost frame or timeout tries again.
          if (status === 'loading') status = 'error';
        },
      )
      .finally(() => {
        if (mine === epoch) loading = null;
        markDirty();
      });
    return loading;
  }

  const detachFrames = source?.onAccountDelta(ingest);
  let wasOpen = false;
  const detachStatus = source?.onStatus?.((next) => {
    if (next === 'open' && wasOpen && status === 'ready') void resync();
    if (next === 'open') wasOpen = true;
  });

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (disposed) return Promise.resolve();
      if (status === 'idle' || status === 'error') {
        status = 'loading';
        markDirty();
      }
      source?.focus(focus?.symbol ?? null, focus?.exchange);
      return resync();
    },
    clear() {
      epoch += 1;
      loading = null;
      held = null;
      for (const { timer } of intents.values()) timers.clearTimeout(timer);
      intents.clear();
      orders.clear();
      stops.clear();
      positions.clear();
      changedOrders.clear();
      changedStops.clear();
      funds = null;
      seq = 0;
      status = 'idle';
      reloaded = true;
      positionsChanged = true;
      fundsChanged = true;
      markDirty();
    },
    resync,
    focus(symbol, exchange = 'NSE') {
      const next = symbol === null ? null : { symbol, exchange };
      if (next?.symbol === focus?.symbol && next?.exchange === focus?.exchange) return;
      focus = next;
      depth = null;
      source?.focus(symbol, exchange);
      markDirty();
    },
    ingest,
    applyOrder(order) {
      if (status !== 'idle') putOrder(order);
    },
    applyTrailingStop(stop) {
      if (status !== 'idle') putStop(stop);
    },
    begin(intent) {
      intentCount += 1;
      const key = `${intent.kind}:${intent.orderId ?? intent.trailingStopId ?? intent.clientOrderId ?? ''}:${String(intentCount)}`;
      const pending: PendingIntent = { ...intent, key, startedAt: now() };
      const timer = timers.setTimeout(() => {
        if (!intents.has(key)) return;
        settle(key);
        for (const listener of [...timeoutListeners]) listener(pending);
        void resync();
      }, intentTimeoutMs);
      intents.set(key, { intent: pending, timer });
      markDirty();
      return {
        key,
        ack(entity) {
          if (entity && status !== 'idle') {
            if ('protectedQty' in entity) putStop(entity);
            else putOrder(entity);
          }
          settle(key);
        },
        fail() {
          settle(key);
        },
      };
    },
    onIntentTimeout(listener) {
      timeoutListeners.add(listener);
      return () => {
        timeoutListeners.delete(listener);
      };
    },
    flush,
    dispose() {
      disposed = true;
      detachFrames?.();
      detachStatus?.();
      for (const { timer } of intents.values()) timers.clearTimeout(timer);
      intents.clear();
      listeners.clear();
      timeoutListeners.clear();
    },
  };
}

/** The trading source over the app's WebSocket client. */
export function tradingSourceOf(
  client: Pick<WsClient, 'onMessage' | 'focus' | 'onStatus'>,
): TradingSource {
  return {
    onAccountDelta: (listener) =>
      client.onMessage((message) => {
        if (message.type === 'accountDelta') listener(message);
      }),
    focus: (symbol, exchange) => {
      client.focus(symbol, exchange);
    },
    onStatus: (listener) => client.onStatus(listener),
  };
}
