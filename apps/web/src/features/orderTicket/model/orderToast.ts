import type { Order } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { strings } from '../strings';

/**
 * The success toast for a placed order (T-139): "Order executed" with the fill price, "Order
 * placed" for an open limit order, "AMO placed" for an after-market order.
 */
export function successToast(order: Order): { title: string; description: string } {
  const title =
    order.status === 'EXECUTED'
      ? strings.success.EXECUTED
      : order.status === 'AMO'
        ? strings.success.AMO
        : strings.success.OPEN;
  const price = order.status === 'EXECUTED' ? order.avgFillPrice : order.price;
  const what =
    price === null
      ? strings.success.atMarket(order.side, order.qty, order.symbol)
      : strings.success.atPrice(order.side, order.qty, order.symbol, formatInr(price));
  return {
    title,
    description: order.status === 'AMO' ? `${what}. ${strings.success.amoWhen}` : what,
  };
}

/** The toast after a modify that left the order open (T-145): "Order modified" with its terms. */
export function modifiedToast(order: Order): { title: string; description: string } {
  const what =
    order.price === null
      ? strings.success.atMarket(order.side, order.qty, order.symbol)
      : strings.success.atPrice(order.side, order.qty, order.symbol, formatInr(order.price));
  return { title: strings.modify.done, description: what };
}
