import type { OrderSide, OrderType } from '@nthstock/contracts';
import { assertPositivePaise, assertQty } from './context.js';

/** The parts of an order the matcher needs. `price` is the limit in paise; `null` for MARKET. */
export type MatchableOrder = {
  side: OrderSide;
  type: OrderType;
  qty: number;
  /** Already filled; defaults to 0. */
  filledQty?: number;
  price: number | null;
};

/** A fill of `qty` shares at `price` paise. */
export type Fill = {
  qty: number;
  price: number;
};

/**
 * Pure fill matcher (ADR 0004). Given an order and the current LTP in paise, returns the fill or
 * `null` when the order does not fill at this price.
 *
 * - MARKET fills the whole remaining quantity at the LTP.
 * - LIMIT BUY fills the whole remaining quantity at the limit when LTP ≤ limit.
 * - LIMIT SELL fills the whole remaining quantity at the limit when LTP ≥ limit.
 *
 * An order with nothing left to fill never fills again.
 */
export function matchFill(order: MatchableOrder, ltp: number): Fill | null {
  assertPositivePaise(ltp, 'LTP');
  assertQty(order.qty, 'Order quantity');
  const filledQty = order.filledQty ?? 0;
  if (!Number.isSafeInteger(filledQty) || filledQty < 0 || filledQty > order.qty) {
    throw new RangeError(`Filled quantity must be a whole number from 0 to ${String(order.qty)}`);
  }
  const remaining = order.qty - filledQty;
  if (remaining === 0) return null;

  if (order.type === 'MARKET') {
    if (order.price !== null) throw new RangeError('A market order has no price');
    return { qty: remaining, price: ltp };
  }

  if (order.price === null) throw new RangeError('A limit order needs a price');
  assertPositivePaise(order.price, 'Limit price');
  const crosses = order.side === 'BUY' ? ltp <= order.price : ltp >= order.price;
  return crosses ? { qty: remaining, price: order.price } : null;
}

/** The result of running an order along a scripted price path. */
export type PathFill = Fill & {
  /** Index into the path of the tick that filled the order. */
  tickIndex: number;
};

/**
 * Walks `ltps` in order and returns the first fill, or `null` if no tick fills the order.
 * Useful for replaying a tick stream and for tests.
 */
export function firstFillOnPath(order: MatchableOrder, ltps: readonly number[]): PathFill | null {
  for (const [tickIndex, ltp] of ltps.entries()) {
    const fill = matchFill(order, ltp);
    if (fill) return { ...fill, tickIndex };
  }
  return null;
}
