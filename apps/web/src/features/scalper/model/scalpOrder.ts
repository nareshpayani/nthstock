import {
  PlaceOrderRequest,
  type Depth,
  type InstrumentToken,
  type Order,
  type OrderSide,
} from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { strings } from '../strings';

/** The quantity chips (SPEC-TFC-1 §11.2); the pad adds the last custom size after them. */
export const QTY_PRESETS = [1, 5, 10, 25] as const;

/** The best bid and ask in paise, from the depth in the same frame as the tick (§11.2). */
export function touchPrices(depth: Depth | null): { bid: number | null; ask: number | null } {
  const bid = depth?.bids[0]?.price ?? 0;
  const ask = depth?.asks[0]?.price ?? 0;
  return { bid: bid > 0 ? bid : null, ask: ask > 0 ? ask : null };
}

/**
 * The order behind a pad button: an intraday IOC limit at the price on the button, so it fills
 * at that price or better at once and leaves nothing resting (§11.2, TFC-22).
 */
export function scalpRequest(
  side: OrderSide,
  qty: number,
  price: number,
  token: InstrumentToken,
  clientOrderId: string,
): PlaceOrderRequest {
  return PlaceOrderRequest.parse({
    token,
    side,
    type: 'LIMIT',
    product: 'INTRADAY',
    qty,
    price,
    validity: 'IOC',
    clientOrderId,
  });
}

export function newScalpOrderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `scp_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export type AckTone = 'sending' | 'filled' | 'partial' | 'unfilled' | 'rejected' | 'info';
export type Ack = { tone: AckTone; text: string };

const pastVerb = (side: OrderSide) => (side === 'BUY' ? 'Bought' : 'Sold');

export const sendingAck = (side: OrderSide, qty: number): Ack => ({
  tone: 'sending',
  text: strings.ack.sending(side === 'BUY' ? 'Buying' : 'Selling', qty),
});

/**
 * The acknowledgement for the engine's answer (§11.4). An IOC order comes back settled: executed,
 * cancelled with part or none of it filled, or rejected with a reason.
 */
export function ackFor(order: Order): Ack {
  const price = order.avgFillPrice === null ? null : formatInr(order.avgFillPrice);
  if (order.status === 'REJECTED') {
    return { tone: 'rejected', text: strings.ack.rejected(order.statusReason ?? 'not accepted') };
  }
  if (order.status === 'EXECUTED' && price !== null) {
    return {
      tone: 'filled',
      text: strings.ack.filled(pastVerb(order.side), order.filledQty, price),
    };
  }
  if (order.filledQty > 0 && price !== null) {
    return {
      tone: 'partial',
      text: strings.ack.partial(pastVerb(order.side), order.filledQty, order.qty, price),
    };
  }
  return { tone: 'unfilled', text: strings.ack.unfilled };
}

/**
 * The acknowledgement for a close (Flatten, or the first leg of Reverse; §11.2, T22). The close is
 * a reduce-only market exit, so it settles at once: all of it, part of it ("Partly closed: N
 * left"), none, or a rejection.
 */
export function closeAck(order: Order): Ack {
  const price = order.avgFillPrice === null ? null : formatInr(order.avgFillPrice);
  if (order.status === 'REJECTED') {
    return { tone: 'rejected', text: strings.ack.rejected(order.statusReason ?? 'not accepted') };
  }
  if (order.filledQty >= order.qty && price !== null) {
    return {
      tone: 'filled',
      text: strings.ack.closed(pastVerb(order.side), order.filledQty, price),
    };
  }
  if (order.filledQty > 0) {
    return { tone: 'partial', text: strings.ack.partlyClosed(order.qty - order.filledQty) };
  }
  return { tone: 'unfilled', text: strings.ack.notClosed };
}

/** The acknowledgement for Reverse once its entry, the second leg, has answered. */
export function reverseAck(entry: Order): Ack {
  const next = ackFor(entry);
  if (next.tone === 'filled' || next.tone === 'partial') {
    return { tone: next.tone, text: strings.ack.reversed(next.text) };
  }
  if (next.tone === 'rejected') {
    return {
      tone: 'rejected',
      text: strings.ack.reverseRejected(entry.statusReason ?? 'not accepted'),
    };
  }
  return { tone: 'unfilled', text: strings.ack.reverseUnfilled };
}

/** A whole number of shares, 1 or more, from the custom field; null otherwise. */
export function parseQty(text: string): number | null {
  if (!/^\d{1,6}$/.test(text.trim())) return null;
  const qty = Number(text.trim());
  return qty >= 1 ? qty : null;
}
