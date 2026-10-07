import { isApiError } from '@nthstock/apiClient';
import type { ModifyOrderRequest } from '@nthstock/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { fundsKeys, ordersKeys } from '@/shared/lib/queryKeys';

export type ModifyOrderInput = { id: string; body: ModifyOrderRequest };

/**
 * `PATCH /v1/orders/:id` (T-145). A modify changes blocked cash and may fill the order, and a
 * refusal (409: it filled or was cancelled meanwhile) means the book is stale, so orders and funds
 * refetch unless the request never reached the server.
 */
export function useModifyOrder() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: ModifyOrderInput) =>
      api.request('orderModify', { params: { id }, body }),
    onSettled: (_order, error) => {
      if (error && isApiError(error) && error.kind === 'network') return;
      void queryClient.invalidateQueries({ queryKey: ordersKeys.all });
      void queryClient.invalidateQueries({ queryKey: fundsKeys.all });
    },
  });
}
