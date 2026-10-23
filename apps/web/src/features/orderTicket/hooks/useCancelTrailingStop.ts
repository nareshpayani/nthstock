import type { TrailingStop } from '@nthstock/contracts';
import { useMutation } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

/** `DELETE /v1/trailing-stops/:id` (T18) as a pending intent on the trading store (ADR 0012). */
export function useCancelTrailingStop() {
  const api = useApiClient();
  const store = useTradingStore();
  return useMutation({
    mutationFn: async (id: string): Promise<TrailingStop> => {
      const intent = store.begin({ kind: 'cancelTrailingStop', trailingStopId: id });
      try {
        const stop = await api.request('trailingStopCancel', { params: { id } });
        intent.ack(stop);
        return stop;
      } catch (error) {
        intent.fail();
        throw error;
      }
    },
  });
}
