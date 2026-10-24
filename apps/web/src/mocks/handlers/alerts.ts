import type { Notification, PriceAlert, RouteName } from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import {
  ALERT_DESK_SNAPSHOT_VERSION,
  AlertDesk,
  type AlertActionResult,
  type AlertDeskSnapshot,
} from '@nthstock/paperEngine';
import { formatInr } from '@nthstock/utils';
import type { HttpHandler } from 'msw';
import {
  MockApiError,
  defineRoute,
  type ResolverContext,
  type RouteHandlerOptions,
  type RouteResolver,
} from '../handlerKit';
import type { AuthMock } from './auth';
import type { OrdersMock } from './orders';

/**
 * MSW price alerts and notifications (NSTOCK-0344) on the same `AlertDesk` apps/api runs, fed by
 * the in-browser mock market. A fired alert, an executed order and a triggered trailing stop each
 * add a notification, and the mock WebSocket sends it to its owner at once (`onNotification`).
 *
 * The desk is saved to sessionStorage on every change (they are rare: a create, a cancel, a fire,
 * a read), so alerts survive a reload; without storage, or with a corrupt entry, it starts empty.
 */

/** sessionStorage key of the persisted alerts mock state. */
export const ALERTS_MOCK_STORAGE_KEY = 'nthstock.msw.alerts';

export type AlertsMockOptions = {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  newId?: () => string;
};

export type NotificationListener = (
  userId: string,
  notification: Notification,
  alert?: PriceAlert,
) => void;

const randomId = () => crypto.randomUUID();

function load(storage: AlertsMockOptions['storage']): AlertDeskSnapshot | null {
  try {
    const raw = storage?.getItem(ALERTS_MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AlertDeskSnapshot>;
    return parsed.v === ALERT_DESK_SNAPSHOT_VERSION && parsed.users
      ? (parsed as AlertDeskSnapshot)
      : null;
  } catch {
    return null;
  }
}

export function createAlertsMock(
  adapter: MarketDataAdapter,
  auth: Pick<AuthMock, 'userIdOf'>,
  orders: Pick<OrdersMock, 'onOrderUpdate' | 'onTrailingStopUpdate'>,
  { now = Date.now, storage, newId = randomId }: AlertsMockOptions = {},
) {
  const listeners = new Set<NotificationListener>();
  const save = () => {
    if (!storage) return;
    try {
      storage.setItem(ALERTS_MOCK_STORAGE_KEY, JSON.stringify(desk.snapshot()));
    } catch {
      // Storage is a convenience; the in-memory state still works.
    }
  };
  const desk = new AlertDesk({
    clock: { now: () => new Date(now()) },
    market: adapter,
    newId,
    onNotification: (userId, notification, alert) => {
      for (const listener of [...listeners]) listener(userId, notification, alert);
    },
    onChange: save,
  });
  const saved = load(storage);
  if (saved) desk.restore(saved);

  // Fills and stops raise notifications once each, on the change that ends them.
  const notified = new Set<string>();
  const stopOrders = orders.onOrderUpdate((userId, order) => {
    if (order.status !== 'EXECUTED' || order.avgFillPrice === null || notified.has(order.id)) {
      return;
    }
    notified.add(order.id);
    desk.notify(userId, {
      kind: 'ORDER_FILLED',
      title: 'Order executed',
      body: `${order.side} ${String(order.filledQty)} ${order.symbol} @ ${formatInr(order.avgFillPrice)}`,
      symbol: order.symbol,
      exchange: order.exchange,
    });
  });
  const stopStops = orders.onTrailingStopUpdate((userId, stop) => {
    if (stop.status !== 'TRIGGERED' || notified.has(stop.id)) return;
    notified.add(stop.id);
    desk.notify(userId, {
      kind: 'TRAILING_STOP',
      title: `${stop.symbol} trailing stop triggered`,
      body:
        stop.stopPrice === null
          ? `Exiting ${String(stop.protectedQty)} shares`
          : `Stop ${formatInr(stop.stopPrice)} reached · exiting ${String(stop.protectedQty)} shares`,
      symbol: stop.symbol,
      exchange: stop.exchange,
    });
  });

  const userOf = (context: Pick<ResolverContext<RouteName>, 'request' | 'cookies'>) =>
    auth.userIdOf(context);

  const answer = (result: AlertActionResult): PriceAlert => {
    if (result.ok) return result.alert;
    const status = {
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      LIMIT_REACHED: 422,
      INVALID_STATE: 409,
    }[result.code];
    const code = result.code === 'INVALID_STATE' ? 'CONFLICT' : result.code;
    throw new MockApiError(status, code, result.message);
  };

  const handlers = (options: RouteHandlerOptions = {}): HttpHandler[] => {
    const route = <N extends RouteName>(name: N, resolver: RouteResolver<N>) =>
      defineRoute(name, resolver, options);
    return [
      route('priceAlertsList', (context) => ({ items: desk.alerts(userOf(context)) })),
      route('priceAlertCreate', async (context) =>
        answer(await desk.create(userOf(context), context.body)),
      ),
      route('priceAlertCancel', (context) =>
        answer(desk.cancel(userOf(context), context.params.id)),
      ),
      route('notificationsList', (context) => desk.notifications(userOf(context))),
      route('notificationsMarkRead', (context) => desk.markRead(userOf(context), context.body.ids)),
    ];
  };

  return {
    handlers,
    /** Every new notification of every user (the mock WebSocket sends each to its owner). */
    onNotification(listener: NotificationListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A scripted tick for alerts (tests and scenarios). */
    tick: (quotes: Parameters<AlertDesk['onQuotes']>[0]) => {
      desk.onQuotes(quotes);
    },
    dispose() {
      stopOrders();
      stopStops();
      listeners.clear();
      desk.close();
    },
  };
}

export type AlertsMock = ReturnType<typeof createAlertsMock>;
