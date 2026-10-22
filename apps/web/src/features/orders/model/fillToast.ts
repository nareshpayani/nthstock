import type { Order } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { strings } from '../strings';
import { isPartlyFilled } from './orderBook';

/**
 * The toast for a fill that arrives as an `orderUpdate` (T-147): "Order executed" /
 * "BUY 10 INFY @ ₹1,512.35", or for a partial fill (T11) "Order partly filled" /
 * "BUY 3 / 10 INFY @ ₹1,512.35". Null when nothing has filled.
 */
export function fillToast(order: Order): { title: string; description: string } | null {
  if (order.avgFillPrice === null) return null;
  if (isPartlyFilled(order)) {
    return {
      title: strings.fill.partTitle,
      description: strings.fill.partDescription(
        order.side,
        order.filledQty,
        order.qty,
        order.symbol,
        formatInr(order.avgFillPrice),
      ),
    };
  }
  if (order.status !== 'EXECUTED') return null;
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
