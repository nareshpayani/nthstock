import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStepUp } from '@/features/auth';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { activeSessionsKeys } from '@/shared/lib/queryKeys';
import { activeSessionsQuery } from '../api/activeSessionsQuery';

/**
 * Active sessions (NSTOCK-0226): the list, and logging out one other session or all of them. Both
 * logouts go through `useStepUp`, so a 403 STEP_UP_REQUIRED opens the step-up dialog first.
 */
export function useActiveSessions() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const withStepUp = useStepUp();
  const refresh = () => queryClient.invalidateQueries({ queryKey: activeSessionsKeys.all });

  const list = useQuery(activeSessionsQuery(apiClient));
  const revoke = useMutation({
    mutationFn: (id: string) =>
      withStepUp(() => apiClient.request('sessionRevoke', { params: { id } })),
    onSettled: refresh,
  });
  const revokeOthers = useMutation({
    mutationFn: () => withStepUp(() => apiClient.request('sessionsRevokeOthers')),
    onSettled: refresh,
  });

  return { list, revoke, revokeOthers };
}
