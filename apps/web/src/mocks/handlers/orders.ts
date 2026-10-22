import type { InstrumentToken, Order, RouteName, TrailingStop } from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import {
  PAPER_ENGINE_LEGACY_SNAPSHOT_VERSION,
  PAPER_ENGINE_SNAPSHOT_VERSION,
  PaperDesk,
  orderApiError,
  trailingStopApiError,
  type MarketHours,
  type OrderActionResult,
  type PaperEngineSnapshot,
  type TrailingStopActionResult,
} from '@nthstock/paperEngine';
import type { HttpHandler } from 'msw';
import {
  MockApiError,
  defineRoute,
  type ResolverContext,
  type RouteHandlerOptions,
  type RouteResolver,
} from '../handlerKit';
import type { IntervalTimers } from './quoteStream';
import type { AuthMock } from './auth';

/**
 * MSW order, funds and portfolio handlers (T-132, T-142, T-156) on the same `PaperDesk` as apps/api (T-131): one paper
 * engine per user, fed by the in-browser mock market's ticks, so a LIMIT order fills on the tick
 * that crosses it and an `orderUpdate` goes out on the mock WebSocket (`onOrderUpdate`). Refusals
 * use `orderApiError`, so both backends answer alike.
 *
 * Trailing stops (T08, SPEC-TFC-1 §10.6) run on the same engines, and `/v1/account/state` answers
 * with one consistent snapshot at the engine `seq` (ADR 0012).
 *
 * State lives in memory; in the browser each user's engine is also saved to sessionStorage as a
 * snapshot and restored on the next page load. A status change (a fill, a cancel, a stop
 * triggering) saves at once; trailing-stop steps, which can change the engine on every tick, save at
 * most every `ORDERS_SAVE_THROTTLE_MS`, and `flush()` saves what is left when the tab is hidden.
 * Every storage call sits in try/catch: without storage (or with a corrupt entry) the mock starts
 * that account fresh.
 */

/** sessionStorage key of the persisted order mock state. */
export const ORDERS_MOCK_STORAGE_KEY = 'nthstock.msw.orders';

/** At most one save in this window for changes that are not a status change (SPEC-TFC-1 §10.3). */
export const ORDERS_SAVE_THROTTLE_MS = 2_000;

/** How often the browser syncs every account, so 9:15 AMO release and end of day push updates. */
export const ORDER_SWEEP_MS = 15_000;

export type OrdersMockOptions = {
  /** Epoch ms; tests and scenarios inject a clock (shared with auth). */
  now?: () => number;
  /** Where to keep accounts between page loads (the browser passes sessionStorage). */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Ids for orders and ledger entries; default random. */
  newId?: () => string;
  /** Sync every account on this interval (the browser passes `ORDER_SWEEP_MS`); off by default. */
  sweepMs?: number;
  timers?: IntervalTimers;
  /** The save throttle's timer; default the global setTimeout. */
  timeouts?: TimeoutTimers;
  /** `alwaysOpen` with VITE_MOCK_MARKET_OPEN, so the demo trades at any hour (T03); default `nse`. */
  marketHours?: MarketHours;
};

type Saved = {
  v: number;
  users: Record<string, PaperEngineSnapshot>;
};

/**
 * Saved accounts this build reads: its own, and those saved before trailing stops, which the
 * engine migrates on restore (SPEC-TFC-1 §10.3), so the demo state survives the release.
 */
export const READABLE_SAVED_VERSIONS: readonly number[] = [
  PAPER_ENGINE_SNAPSHOT_VERSION,
  PAPER_ENGINE_LEGACY_SNAPSHOT_VERSION,
];

export type OrderUpdateListener = (userId: string, order: Order) => void;
export type TrailingStopUpdateListener = (userId: string, stop: TrailingStop) => void;

export type TimeoutTimers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** The parts of the mock market the orders mock steers, when the adapter has them (the mock does). */
type ReplayingMarket = { setReplaySymbols(symbols: Iterable<string>): void };
const replaysTicks = (adapter: MarketDataAdapter): adapter is MarketDataAdapter & ReplayingMarket =>
  typeof (adapter as Partial<ReplayingMarket>).setReplaySymbols === 'function';

const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `pe_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

function load(storage: OrdersMockOptions['storage']): Record<string, PaperEngineSnapshot> {
  try {
    const saved = storage?.getItem(ORDERS_MOCK_STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    if (
      parsed &&
      typeof parsed === 'object' &&
      READABLE_SAVED_VERSIONS.includes((parsed as Partial<Saved>).v ?? -1) &&
      typeof (parsed as Partial<Saved>).users === 'object'
    ) {
      // The mock wrote it itself; PaperEngine checks each snapshot again on restore.
      return { ...(parsed as Saved).users };
    }
  } catch {
    // Start fresh.
  }
  return {};
}

const defaultTimers: IntervalTimers = {
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

const defaultTimeouts: TimeoutTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** The in-browser paper-trading backend behind the handlers; exported for tests. */
export function createOrdersMock(
  adapter: MarketDataAdapter,
  auth: Pick<AuthMock, 'userIdOf'>,
  {
    now = Date.now,
    storage,
    newId = randomId,
    sweepMs,
    timers = defaultTimers,
    timeouts = defaultTimeouts,
    marketHours = 'nse',
  }: OrdersMockOptions = {},
) {
  const listeners = new Set<OrderUpdateListener>();
  const stopListeners = new Set<TrailingStopUpdateListener>();
  const saved = new Map(Object.entries(load(storage)));
  /** Users whose engine changed since the last save, and whether a status changed. */
  const dirty = new Set<string>();
  let urgent = false;
  let lastSaveAt = Number.NEGATIVE_INFINITY;
  let pendingSave: unknown = null;
  const stopStatus = new Map<string, TrailingStop['status']>();

  const save = () => {
    if (!storage) return;
    for (const userId of dirty) saved.set(userId, desk.engineOf(userId).snapshot());
    dirty.clear();
    urgent = false;
    lastSaveAt = now();
    if (pendingSave !== null) {
      timeouts.clearTimeout(pendingSave);
      pendingSave = null;
    }
    try {
      const state: Saved = {
        v: PAPER_ENGINE_SNAPSHOT_VERSION,
        users: Object.fromEntries(saved),
      };
      storage.setItem(ORDERS_MOCK_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage is a convenience; the in-memory state still works.
    }
  };

  const desk = new PaperDesk({
    clock: { now: () => new Date(now()) },
    market: adapter,
    newId,
    marketHours,
    onOrderUpdate: (userId, order) => {
      urgent = true;
      for (const listener of [...listeners]) listener(userId, order);
    },
    onTrailingStopUpdate: (userId, stop) => {
      if (stopStatus.get(stop.id) !== stop.status) urgent = true;
      stopStatus.set(stop.id, stop.status);
      for (const listener of [...stopListeners]) listener(userId, stop);
    },
    onChange: (userId) => {
      if (replaysTicks(adapter)) adapter.setReplaySymbols(desk.activeSymbols());
      if (!storage) return;
      dirty.add(userId);
      const wait = lastSaveAt + ORDERS_SAVE_THROTTLE_MS - now();
      if (urgent || wait <= 0) save();
      else pendingSave ??= timeouts.setTimeout(save, wait);
    },
  });

  // Accounts saved by an earlier page load. One that no longer restores is dropped.
  const ready = Promise.all(
    [...saved].map(async ([userId, snapshot]) => {
      try {
        await desk.restore(userId, snapshot);
        // Saved again as this build's snapshot, so an older one is migrated once.
        dirty.add(userId);
      } catch {
        saved.delete(userId);
      }
    }),
  ).then(() => {
    if (replaysTicks(adapter)) adapter.setReplaySymbols(desk.activeSymbols());
    save();
  });

  const sweeper = sweepMs
    ? timers.setInterval(() => {
        void desk.sweep();
      }, sweepMs)
    : null;

  const userOf = (context: Pick<ResolverContext<RouteName>, 'request' | 'cookies'>) =>
    auth.userIdOf(context);

  const answer = (result: OrderActionResult): Order => {
    if (result.ok) return result.order;
    const error = orderApiError(result);
    throw new MockApiError(error.status, error.code, error.message, error.details);
  };

  const answerStop = (result: TrailingStopActionResult): TrailingStop => {
    if (result.ok) return result.trailingStop;
    const error = trailingStopApiError(result);
    throw new MockApiError(error.status, error.code, error.message, error.details);
  };

  const handlers = (options: RouteHandlerOptions = {}): HttpHandler[] => {
    const route = <N extends RouteName>(name: N, resolver: RouteResolver<N>) =>
      defineRoute(
        name,
        async (context) => {
          await ready;
          return resolver(context);
        },
        options,
      );
    return [
      route('ordersList', (context) => {
        const { status, cursor, limit } = context.query;
        const page = desk.ordersPage(userOf(context), {
          ...(status ? { status } : {}),
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        });
        if (!page) throw new MockApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
        return page;
      }),

      route('orderGet', (context) => {
        const order = desk.getOrder(userOf(context), context.params.id);
        if (!order) throw new MockApiError(404, 'NOT_FOUND', 'This order was not found.');
        return order;
      }),

      route('orderHistory', (context) => {
        const history = desk.orderHistory(userOf(context), context.params.id);
        if (!history) throw new MockApiError(404, 'NOT_FOUND', 'This order was not found.');
        return history;
      }),

      route('orderPlace', async (context) =>
        answer(await desk.place(userOf(context), context.body)),
      ),

      route('orderModify', async (context) =>
        answer(await desk.modify(userOf(context), context.params.id, context.body)),
      ),

      route('orderCancel', async (context) =>
        answer(await desk.cancel(userOf(context), context.params.id)),
      ),

      // Trailing stops (T08, SPEC-TFC-1 §10.6): refusals map through `trailingStopApiError`.
      route('trailingStopsList', (context) => ({ items: desk.trailingStops(userOf(context)) })),

      route('trailingStopPlace', async (context) =>
        answerStop(await desk.placeTrailingStop(userOf(context), context.body)),
      ),

      route('trailingStopModify', async (context) =>
        answerStop(await desk.modifyTrailingStop(userOf(context), context.params.id, context.body)),
      ),

      route('trailingStopCancel', async (context) =>
        answerStop(await desk.cancelTrailingStop(userOf(context), context.params.id)),
      ),

      route('accountState', (context) => desk.accountState(userOf(context))),

      route('positionClose', async (context) =>
        answer(await desk.closePosition(userOf(context), context.body.token, context.body.product)),
      ),

      route('fundsSummary', (context) => desk.fundsSummary(userOf(context))),

      // The funds ledger and the reset (T-156), with the same rules as apps/api (T-155): pages
      // newest first by cursor, and a reset cancels open orders, clears positions and holdings and
      // writes a RESET entry that restores the opening balance. `onChange` then saves the cleared
      // engine, so the reset survives a reload.
      route('fundsLedger', (context) => {
        const { cursor, limit } = context.query;
        const page = desk.ledgerPage(userOf(context), {
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        });
        if (!page) throw new MockApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
        return page;
      }),

      route('fundsReset', (context) => desk.reset(userOf(context))),

      // Positions, holdings and the portfolio summary (T-142): read from the same engines as the
      // orders above, valued at the LTP they see, exactly as apps/api does (T-141).
      route('positionsList', async (context) => ({
        items: await desk.positions(userOf(context)),
      })),

      route('holdingsList', async (context) => ({ items: await desk.holdings(userOf(context)) })),

      route('portfolioSummary', (context) => desk.portfolioSummary(userOf(context))),
    ];
  };

  return {
    handlers,
    /** Resolves once saved accounts are restored. */
    ready,
    /** Every order change of every user (the mock WebSocket sends each to its owner). */
    onOrderUpdate(listener: OrderUpdateListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Every trailing-stop change of every user (SPEC-TFC-1 §10.1). */
    onTrailingStopUpdate(listener: TrailingStopUpdateListener): () => void {
      stopListeners.add(listener);
      return () => {
        stopListeners.delete(listener);
      };
    },
    /** The user's account at one `seq`; the mock WebSocket reads positions and funds from it. */
    accountState: (userId: string) => desk.accountState(userId),
    /** Saves throttled changes now: the browser calls it when the tab is hidden. */
    flush() {
      if (dirty.size > 0) save();
    },
    /** A scripted tick (tests and scenarios); see `PaperDesk.pinPrice`. */
    pinPrice: (token: InstrumentToken, ltp: number) => {
      desk.pinPrice(token, ltp);
    },
    /** Caps LIMIT fills per tick in one instrument (the demo Simulator's split fills); null lifts it. */
    setFillCap: (token: InstrumentToken, maxQty: number | null) => {
      desk.setFillCap(token, maxQty);
    },
    /** Syncs every account now (what the sweep timer does). */
    sweep: () => desk.sweep(),
    dispose() {
      if (sweeper !== null) timers.clearInterval(sweeper);
      if (pendingSave !== null) timeouts.clearTimeout(pendingSave);
      listeners.clear();
      stopListeners.clear();
      desk.dispose();
    },
  };
}

export type OrdersMock = ReturnType<typeof createOrdersMock>;
