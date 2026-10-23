import type { Order, PlaceOrderRequest } from '@nthstock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { fundsKeys, ordersKeys } from '@/shared/lib/queryKeys';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

/**
 * Sends a scalp order (T21) as a pending placement on the trading store (ADR 0012), so the order
 * book and position show it at once and the engine's answer lands in the same commit. Resolves
 * with the settled IOC order; rejects with the API error.
 */
export function useScalpOrder() {
  const api = useApiClient();
  const store = useTradingStore();
  const queryClient = useQueryClient();
  return async (request: PlaceOrderRequest): Promise<Order> => {
    const intent = store.begin({
      kind: 'place',
      ...(request.clientOrderId ? { clientOrderId: request.clientOrderId } : {}),
    });
    try {
      const order = await api.request('orderPlace', { body: request });
      intent.ack(order);
      return order;
    } catch (error) {
      intent.fail();
      throw error;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ordersKeys.all });
      void queryClient.invalidateQueries({ queryKey: fundsKeys.all });
    }
  };
}
