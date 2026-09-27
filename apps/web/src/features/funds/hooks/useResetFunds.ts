import { useMutation, useQueryClient } from '@tanstack/react-query';
import { holdingsKeys } from '@/features/holdings';
import { ordersKeys } from '@/features/orders';
import { positionsKeys } from '@/features/positions';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { fundsKeys } from '../api/fundsQuery';

/**
 * `POST /v1/funds/reset` with `{ confirm: 'RESET' }` (T-160). A reset clears the whole paper
 * account, so funds, orders, positions and holdings all refetch; the new summary is written into
 * the cache at once, so Funds shows ₹10,00,000.00 without waiting.
 */
export function useResetFunds() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.request('fundsReset', { body: { confirm: 'RESET' } }),
    onSuccess: (summary) => {
      queryClient.setQueryData(fundsKeys.summary(), summary);
    },
    onSettled: () => {
      for (const queryKey of [fundsKeys.all, ordersKeys.all, positionsKeys.all, holdingsKeys.all]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
