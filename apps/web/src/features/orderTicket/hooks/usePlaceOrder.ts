import { isApiError } from '@nthstock/apiClient';
import type { PlaceOrderRequest } from '@nthstock/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fundsKeys } from '@/features/funds';
import { ordersKeys } from '@/features/orders';
import { useApiClient } from '@/shared/lib/apiClientContext';

/**
 * `POST /v1/orders` (T-139). Whenever the server stored an order (placed, or REJECTED with a 422)
 * the order book and funds are stale, so every `orders` and `funds` query is invalidated.
 */
export function usePlaceOrder() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: PlaceOrderRequest) => api.request('orderPlace', { body: request }),
    onSettled: (_order, error) => {
      if (error && !(isApiError(error) && error.status === 422)) return;
      // Not awaited: the ticket closes at once and the lists refetch behind it.
      void queryClient.invalidateQueries({ queryKey: ordersKeys.all });
      void queryClient.invalidateQueries({ queryKey: fundsKeys.all });
    },
  });
}
