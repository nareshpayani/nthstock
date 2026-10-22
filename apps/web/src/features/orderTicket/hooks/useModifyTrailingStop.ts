import type { ModifyTrailingStopRequest, TrailingStop } from '@nthstock/contracts';
import { useMutation } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

/**
 * `PATCH /v1/trailing-stops/:id` (T18) as a pending intent on the trading store (ADR 0012): the
 * stop shows as changing at once, and the engine's answer lands in the store when it comes.
 */
export function useModifyTrailingStop() {
  const api = useApiClient();
  const store = useTradingStore();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: ModifyTrailingStopRequest;
    }): Promise<TrailingStop> => {
      const intent = store.begin({ kind: 'modifyTrailingStop', trailingStopId: id });
      try {
        const stop = await api.request('trailingStopModify', { params: { id }, body });
        intent.ack(stop);
        return stop;
      } catch (error) {
        intent.fail();
        throw error;
      }
    },
  });
}
