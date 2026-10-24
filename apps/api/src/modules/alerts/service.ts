import { randomUUID } from 'node:crypto';
import type {
  CreatePriceAlertRequest,
  NotificationsResponse,
  PriceAlert,
} from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import { AlertDesk, type AlertActionResult } from '@nthstock/paperEngine';
import { formatInr, type Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { OrderService } from '../orders/index.js';

export type AlertServiceOptions = {
  clock: Clock;
  market: MarketDataAdapter;
  /** Executed orders raise "Order executed" notifications. */
  orders: Pick<OrderService, 'onOrderUpdate'>;
  newId?: () => string;
};

const STATUS = { NOT_FOUND: 404, VALIDATION_ERROR: 400, LIMIT_REACHED: 422, INVALID_STATE: 409 };

/**
 * Price alerts and notifications (NSTOCK-0344) on the same `AlertDesk` as the MSW mock, kept in
 * process memory like the paper desk before T-204. Fills notify through `orders.onOrderUpdate`.
 * The notifications are read over REST; pushing them through apps/realtime is the notifications
 * service of the Phase 3 to 5 roadmap.
 */
export function createAlertService({
  clock,
  market,
  orders,
  newId = () => `al_${randomUUID().replaceAll('-', '')}`,
}: AlertServiceOptions) {
  const desk = new AlertDesk({ clock, market, newId });
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

  const answer = (result: AlertActionResult): PriceAlert => {
    if (result.ok) return result.alert;
    const code = result.code === 'INVALID_STATE' ? 'CONFLICT' : result.code;
    throw new ApiHttpError(STATUS[result.code], code, result.message);
  };

  return {
    list: (userId: string) => ({ items: desk.alerts(userId) }),
    create: async (userId: string, request: CreatePriceAlertRequest) =>
      answer(await desk.create(userId, request)),
    cancel: (userId: string, id: string) => answer(desk.cancel(userId, id)),
    notifications: (userId: string): NotificationsResponse => desk.notifications(userId),
    markRead: (userId: string, ids?: readonly string[]) => desk.markRead(userId, ids),
    dispose() {
      stopOrders();
      desk.close();
    },
  };
}

export type AlertService = ReturnType<typeof createAlertService>;
