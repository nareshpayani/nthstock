import type { InstrumentToken, Order, RouteName } from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import {
  PAPER_ENGINE_SNAPSHOT_VERSION,
  PaperDesk,
  orderApiError,
  type OrderActionResult,
  type PaperEngineSnapshot,
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
 * MSW order and funds handlers (T-132) on the same `PaperDesk` as apps/api (T-131): one paper
 * engine per user, fed by the in-browser mock market's ticks, so a LIMIT order fills on the tick
 * that crosses it and an `orderUpdate` goes out on the mock WebSocket (`onOrderUpdate`). Refusals
 * use `orderApiError`, so both backends answer alike.
 *
 * State lives in memory; in the browser each user's engine is also saved to sessionStorage as a
 * snapshot after every change, and restored on the next page load. Every storage call sits in
 * try/catch: without storage (or with a corrupt entry) the mock starts that account fresh.
 */

/** sessionStorage key of the persisted order mock state. */
export const ORDERS_MOCK_STORAGE_KEY = 'nthstock.msw.orders';

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
};

type Saved = {
  v: typeof PAPER_ENGINE_SNAPSHOT_VERSION;
  users: Record<string, PaperEngineSnapshot>;
};

export type OrderUpdateListener = (userId: string, order: Order) => void;

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
      (parsed as Partial<Saved>).v === PAPER_ENGINE_SNAPSHOT_VERSION &&
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
  }: OrdersMockOptions = {},
) {
  const listeners = new Set<OrderUpdateListener>();
  const saved = new Map(Object.entries(load(storage)));

  const save = () => {
    if (!storage) return;
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
    onOrderUpdate: (userId, order) => {
      for (const listener of [...listeners]) listener(userId, order);
    },
    onChange: (userId, engine) => {
      if (!storage) return;
      saved.set(userId, engine.snapshot());
      save();
    },
  });

  // Accounts saved by an earlier page load. One that no longer restores is dropped.
  const ready = Promise.all(
    [...saved].map(async ([userId, snapshot]) => {
      try {
        await desk.restore(userId, snapshot);
      } catch {
        saved.delete(userId);
      }
    }),
  ).then(save);

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

      route('orderPlace', async (context) =>
        answer(await desk.place(userOf(context), context.body)),
      ),

      route('orderModify', async (context) =>
        answer(await desk.modify(userOf(context), context.params.id, context.body)),
      ),

      route('orderCancel', async (context) =>
        answer(await desk.cancel(userOf(context), context.params.id)),
      ),

      route('fundsSummary', (context) => desk.fundsSummary(userOf(context))),
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
    /** A scripted tick (tests and scenarios); see `PaperDesk.pinPrice`. */
    pinPrice: (token: InstrumentToken, ltp: number) => {
      desk.pinPrice(token, ltp);
    },
    /** Syncs every account now (what the sweep timer does). */
    sweep: () => desk.sweep(),
    dispose() {
      if (sweeper !== null) timers.clearInterval(sweeper);
      listeners.clear();
      desk.dispose();
    },
  };
}

export type OrdersMock = ReturnType<typeof createOrdersMock>;
