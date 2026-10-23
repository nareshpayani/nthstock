import type { InstrumentToken, Order } from '@nthstock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { fundsKeys, ordersKeys } from '@/shared/lib/queryKeys';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

/**
 * Closes this instrument's intraday position in one engine step (SPEC-TFC-1 §6.4, T22): cancels
 * its trailing stop and working orders and sends a reduce-only market exit. Runs as a
 * `closePosition` intent on the trading store (ADR 0012). Resolves with the exit order; rejects
 * with the API error, for example when there is no position to close.
 */
export function useClosePosition() {
  const api = useApiClient();
  const store = useTradingStore();
  const queryClient = useQueryClient();
  return async (token: InstrumentToken): Promise<Order> => {
    const intent = store.begin({ kind: 'closePosition' });
    try {
      const order = await api.request('positionClose', { body: { token, product: 'INTRADAY' } });
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
