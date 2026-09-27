import type { Order } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { strings } from '../strings';

/**
 * The toast for a fill that arrives as an `orderUpdate` (T-147):
 * "Order executed" / "BUY 10 INFY @ ₹1,512.35". Null when the order is not executed.
 */
export function fillToast(order: Order): { title: string; description: string } | null {
  if (order.status !== 'EXECUTED' || order.avgFillPrice === null) return null;
  return {
    title: strings.fill.title,
    description: strings.fill.description(
      order.side,
      order.filledQty,
      order.symbol,
      formatInr(order.avgFillPrice),
    ),
  };
}
