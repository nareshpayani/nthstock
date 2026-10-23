import type { Order } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import type { PendingOrderPrice } from '@/shared/hooks/usePendingOrderPrices';
import { strings } from '../strings';
import type { OverlayLine } from './overlayLine';

/** The id of an order line's × action. */
export const CANCEL_ACTION = 'cancel';

/** A limit order still working on the book: the ones drawn as lines (§8.1). */
export const isWorkingLimit = (order: Order): order is Order & { price: number } =>
  (order.status === 'OPEN' || order.status === 'AMO') &&
  order.type === 'LIMIT' &&
  order.price !== null &&
  order.filledQty < order.qty;

/**
 * The line for a working limit order (T16, SPEC-TFC-1 §8.1, §8.3). It sits at the price under the
 * finger while dragged, and dotted at the new price with "Updating…" once sent, until the engine
 * answers. Its × asks "Cancel?" first; a second tap within 3 seconds cancels.
 */
export function orderLine(
  order: Order & { price: number },
  pending: PendingOrderPrice | undefined,
  cancelArmed: boolean,
): OverlayLine {
  const open = order.qty - order.filledQty;
  const side = strings.order.sides[order.side];
  const price = pending?.price ?? order.price;
  const sending = pending?.phase === 'sending';
  return {
    id: order.id,
    price,
    tone: sending ? 'pending' : order.side === 'BUY' ? 'buy' : 'sell',
    label: sending
      ? strings.order.updating(formatInr(price))
      : strings.order.label(side, open, formatInr(price)),
    description: strings.order.description(side, open, formatInr(price)),
    draggable: !sending,
    actions: sending
      ? undefined
      : [
          {
            id: CANCEL_ACTION,
            label: cancelArmed ? strings.order.confirmCancel : '×',
            description: cancelArmed
              ? strings.order.confirmCancelDescription(side, open, formatInr(order.price))
              : strings.order.cancelDescription(side, open, formatInr(order.price)),
            look: cancelArmed ? 'armed' : 'plain',
          },
        ],
  };
}
