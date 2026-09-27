import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fundsKeys } from '@/features/funds';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { ordersKeys } from '../api/ordersQuery';

/**
 * `DELETE /v1/orders/:id` (T-145). Settled either way, the order book and funds may have moved
 * (a refused cancel means the order filled or was cancelled meanwhile), so both refetch.
 */
export function useCancelOrder() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request('orderCancel', { params: { id } }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ordersKeys.all });
      void queryClient.invalidateQueries({ queryKey: fundsKeys.all });
    },
  });
}
