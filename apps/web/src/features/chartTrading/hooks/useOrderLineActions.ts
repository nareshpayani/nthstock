import { isApiError } from '@nthstock/apiClient';
import type { Order, TrailingStop } from '@nthstock/contracts';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

/** What went wrong, in words: the engine's own reason on a 409, else a generic line. */
export function actionErrorText(error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === 'network') return 'Check your connection and try again.';
    if (error.message) return error.message;
  }
  return 'Something went wrong. Try again.';
}

/**
 * Modify and cancel from a chart line (T16, SPEC-TFC-1 §8.3), and moving a trailing stop (T19), as pending intents on the trading
 * store (ADR 0012): every surface shows the change pending at once, and the order the engine
 * returns lands in the store when it answers. A refusal settles the intent with nothing applied,
 * so the line goes back to the order's real price.
 */
export function useOrderLineActions() {
  const api = useApiClient();
  const store = useTradingStore();
  return {
    async modify(order: Order, price: number): Promise<Order> {
      const intent = store.begin({ kind: 'modify', orderId: order.id, price });
      try {
        const modified = await api.request('orderModify', {
          params: { id: order.id },
          body: { price },
        });
        intent.ack(modified);
        return modified;
      } catch (error) {
        intent.fail();
        throw error;
      }
    },
    /** Moves a trailing stop to `stopPrice`; the engine turns it into a trail (T19, §6.5). */
    async modifyStop(stop: TrailingStop, stopPrice: number): Promise<TrailingStop> {
      const intent = store.begin({ kind: 'modifyTrailingStop', trailingStopId: stop.id });
      try {
        const modified = await api.request('trailingStopModify', {
          params: { id: stop.id },
          body: { stopPrice },
        });
        intent.ack(modified);
        return modified;
      } catch (error) {
        intent.fail();
        throw error;
      }
    },
    async cancel(order: Order): Promise<Order> {
      const intent = store.begin({ kind: 'cancel', orderId: order.id });
      try {
        const cancelled = await api.request('orderCancel', { params: { id: order.id } });
        intent.ack(cancelled);
        return cancelled;
      } catch (error) {
        intent.fail();
        throw error;
      }
    },
  };
}
