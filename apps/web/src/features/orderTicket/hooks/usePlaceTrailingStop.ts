import type { PlaceTrailingStopRequest, TrailingStop } from '@nthstock/contracts';
import { useMutation } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

/**
 * `POST /v1/trailing-stops` (T13) as a pending intent on the trading store (ADR 0012): screens see
 * it pending at once, and the stop the engine returns lands in the store when it answers, so the
 * chart and the positions agree without waiting for the next frame.
 */
export function usePlaceTrailingStop() {
  const api = useApiClient();
  const store = useTradingStore();
  return useMutation({
    mutationFn: async (request: PlaceTrailingStopRequest): Promise<TrailingStop> => {
      const intent = store.begin({ kind: 'placeTrailingStop' });
      try {
        const stop = await api.request('trailingStopPlace', { body: request });
        intent.ack(stop);
        return stop;
      } catch (error) {
        intent.fail();
        throw error;
      }
    },
  });
}
