import type { TradingState } from '@nthstock/apiClient';
import { useOrderDraftStore } from '@/shared/lib/orderDraftStore';
import { useTradingSelector } from './useTradingSelector';

/** A price an order is moving to: under the finger (`dragging`) or sent and awaiting the engine. */
export type PendingOrderPrice = { price: number; phase: 'dragging' | 'sending' };

type Sending = readonly { orderId: string; price: number }[];

const selectSending = (state: TradingState): Sending =>
  state.pending.flatMap((intent) =>
    intent.kind === 'modify' && intent.orderId !== undefined && intent.price !== undefined
      ? [{ orderId: intent.orderId, price: intent.price }]
      : [],
  );
const sameSending = (a: Sending, b: Sending) =>
  a.length === b.length &&
  a.every((entry, i) => entry.orderId === b[i]?.orderId && entry.price === b[i].price);

/**
 * The prices orders are moving to (T16, TFC-21): the chart drag, else a modify the trading store
 * still holds as pending. Every surface reads this, so they all show the same price at once.
 */
export function usePendingOrderPrices(): ReadonlyMap<string, PendingOrderPrice> {
  const draft = useOrderDraftStore((state) => state.draft);
  const sending = useTradingSelector(selectSending, sameSending);
  const prices = new Map<string, PendingOrderPrice>();
  for (const { orderId, price } of sending) prices.set(orderId, { price, phase: 'sending' });
  if (draft) prices.set(draft.orderId, { price: draft.price, phase: 'dragging' });
  return prices;
}
