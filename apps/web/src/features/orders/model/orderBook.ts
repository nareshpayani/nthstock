import type { Order, OrderStatus } from '@nthstock/contracts';
import { formatInr, formatIstDate, formatIstTimeSeconds, istDateKey } from '@nthstock/utils';
import { strings } from '../strings';

/** The order book tabs (T-144): Open holds AMO and OPEN; Cancelled holds CANCELLED and REJECTED. */
export const ORDER_TABS = ['open', 'executed', 'cancelled'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export const TAB_STATUSES: Record<OrderTab, readonly OrderStatus[]> = {
  open: ['AMO', 'OPEN'],
  executed: ['EXECUTED'],
  cancelled: ['CANCELLED', 'REJECTED'],
};

export function tabOf(status: OrderStatus): OrderTab {
  if (status === 'AMO' || status === 'OPEN') return 'open';
  return status === 'EXECUTED' ? 'executed' : 'cancelled';
}

export type OrderBook = Record<OrderTab, Order[]>;

/** Splits orders (newest first, as the API pages them) into the three tabs, keeping the order. */
export function groupOrders(orders: readonly Order[]): OrderBook {
  const book: OrderBook = { open: [], executed: [], cancelled: [] };
  for (const order of orders) book[tabOf(order.status)].push(order);
  return book;
}

/** Only AMO and OPEN orders can be modified or cancelled (the order state machine). */
export const isLive = (order: Pick<Order, 'status'>) =>
  order.status === 'AMO' || order.status === 'OPEN';

/**
 * When the order was placed, in IST: "10:00:05 am" today, "25 Sept 2026, 08:00:00 pm" on an
 * earlier day (an AMO placed last evening).
 */
export function orderTimeLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = formatIstTimeSeconds(at);
  return istDateKey(at) === istDateKey(now) ? time : `${formatIstDate(at)}, ${time}`;
}

/** The price column: the fill price once executed, else the limit price, else "Market". */
export function priceLabel(order: Pick<Order, 'status' | 'price' | 'avgFillPrice'>): string {
  if (order.status === 'EXECUTED' && order.avgFillPrice !== null) {
    return formatInr(order.avgFillPrice);
  }
  return order.price === null ? strings.atMarket : formatInr(order.price);
}

/** "BUY 10 INFY order": how buttons and dialogs name an order. */
export const orderName = (order: Pick<Order, 'side' | 'qty' | 'symbol'>) =>
  strings.orderName(order.side, order.qty, order.symbol);
