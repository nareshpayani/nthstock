import type { Order, TrailingStop } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import type { NewNotification } from '../notifications/index.js';
import { clearsOrders, type AccountChange } from './accountStore.js';

/** The square-off order's reason in the paper engine (`#squareOffIntraday`). */
const SQUARED_OFF_PREFIX = 'Squared off';

/** A trailing stop that has fired: its exit order is placed (TRIGGERED) or filled (EXECUTED). */
const FIRED = new Set<TrailingStop['status']>(['TRIGGERED', 'EXECUTED']);

const fill = (order: Order) =>
  `${order.side} ${String(order.filledQty)} ${order.symbol} @ ${formatInr(order.avgFillPrice ?? 0)}`;

function orderNotifications(userId: string, order: Order, before: Order | undefined) {
  const base = { userId, refId: order.id, symbol: order.symbol, exchange: order.exchange };
  const out: NewNotification[] = [];
  if (before?.status === 'AMO' && order.status !== 'AMO' && order.status !== 'CANCELLED') {
    out.push({
      ...base,
      kind: 'AMO_RELEASED',
      title: 'After-market order sent',
      body: `${order.side} ${String(order.qty)} ${order.symbol} went to the market at 9:15 AM IST`,
    });
  }
  if (before?.status === order.status) return out;
  if (order.status === 'EXECUTED' && order.avgFillPrice !== null) {
    const squaredOff = order.statusReason?.startsWith(SQUARED_OFF_PREFIX) ?? false;
    out.push({
      ...base,
      kind: squaredOff ? 'SQUARED_OFF' : 'ORDER_FILLED',
      title: squaredOff ? `${order.symbol} squared off` : 'Order executed',
      body: fill(order),
    });
  } else if (order.status === 'REJECTED') {
    out.push({
      ...base,
      kind: 'ORDER_REJECTED',
      title: 'Order rejected',
      body: [`${order.side} ${String(order.qty)} ${order.symbol}`, order.statusReason]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 200),
    });
  }
  return out;
}

function stopNotification(userId: string, stop: TrailingStop): NewNotification {
  return {
    userId,
    kind: 'TRAILING_STOP',
    refId: stop.id,
    title: `${stop.symbol} trailing stop triggered`,
    body:
      stop.stopPrice === null
        ? `Exiting ${String(stop.protectedQty)} shares`
        : `Stop ${formatInr(stop.stopPrice)} reached · exiting ${String(stop.protectedQty)} shares`,
    symbol: stop.symbol,
    exchange: stop.exchange,
  };
}

/**
 * The notifications one account change raises (NSTOCK-0379), with the same wording as the mock:
 * an order that executed (or was squared off) or was rejected, an AMO the 9:15 release sent, and a
 * trailing stop that triggered. Each is raised by the change that makes the transition, so a
 * partial fill notifies nothing until the order completes, and replaying a change raises nothing.
 * A reset or a replacing change raises nothing either: it moves no order through a transition.
 */
export function notificationsForChange(userId: string, change: AccountChange): NewNotification[] {
  if (clearsOrders(change)) return [];
  const beforeOrders = new Map(change.before?.orders.map((order) => [order.id, order]));
  const beforeStops = new Map(change.before?.trailingStops.map((stop) => [stop.id, stop]));
  const out: NewNotification[] = [];
  for (const order of change.after.orders) {
    out.push(...orderNotifications(userId, order, beforeOrders.get(order.id)));
  }
  for (const stop of change.after.trailingStops) {
    // A stop can trigger and see its exit fill within one change, so EXECUTED counts too.
    const was = beforeStops.get(stop.id)?.status;
    if (FIRED.has(stop.status) && (was === undefined || !FIRED.has(was))) {
      out.push(stopNotification(userId, stop));
    }
  }
  return out;
}
