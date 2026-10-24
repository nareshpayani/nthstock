import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { forgetTrustedDevice, useStepUp } from '@/features/auth';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useSessionStore } from '@/shared/lib/sessionStore';

/**
 * Deletes the account (NSTOCK-0234) behind a step-up. On success nothing of the account stays in
 * the tab: the session, the Query cache and the trusted-browser hint go, and /login shows when the
 * data is erased.
 */
export function useDeleteAccount() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const withStepUp = useStepUp();

  return useMutation({
    mutationFn: () =>
      withStepUp(() => apiClient.request('accountDelete', { body: { confirm: 'DELETE' } })),
    onSuccess: async ({ purgeAfter }) => {
      // Leave the guarded page first (it would send an ended session to /login itself), then drop
      // everything the tab holds for the account.
      await navigate({ to: '/login', search: { deleted: purgeAfter }, replace: true });
      useSessionStore.getState().clearSession();
      queryClient.clear();
      forgetTrustedDevice();
    },
  });
}
