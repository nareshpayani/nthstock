import type { Position } from '@nthstock/contracts';
import type { TicketIntent } from '@/shared/lib/ticketIntentStore';

/**
 * What Exit on a position opens (T-150): the order ticket on the opposite side for the whole open
 * quantity, in the position's own product. A long 10 INFY intraday exits as SELL 10 INTRADAY; a
 * short as a BUY. A closed position (net zero) has nothing to exit.
 */
export function exitIntent(
  position: Pick<Position, 'symbol' | 'exchange' | 'product' | 'netQty'>,
): TicketIntent | null {
  if (position.netQty === 0) return null;
  return {
    symbol: position.symbol,
    exchange: position.exchange,
    side: position.netQty > 0 ? 'SELL' : 'BUY',
    qty: Math.abs(position.netQty),
    product: position.product,
  };
}
