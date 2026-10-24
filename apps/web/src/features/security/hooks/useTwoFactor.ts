import type { TotpCodeOrRecoveryRequest } from '@nthstock/contracts';
import { useMutation } from '@tanstack/react-query';
import { useStepUp } from '@/features/auth';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useSessionStore } from '@/shared/lib/sessionStore';

/** Keeps the in-memory session's `totpEnabled` in step with the server. */
function setTotpEnabled(totpEnabled: boolean) {
  const { session, setSession } = useSessionStore.getState();
  if (session) setSession({ ...session, user: { ...session.user, totpEnabled } });
}

/**
 * Two-factor mutations (NSTOCK-0221). Each goes through `useStepUp`, so a 403 STEP_UP_REQUIRED
 * opens the step-up dialog and the call is retried once confirmed. The setup key and recovery
 * codes live only in the mutation result (component memory), never in a store, cache key or URL.
 */
export function useTwoFactor() {
  const apiClient = useApiClient();
  const withStepUp = useStepUp();

  const enrol = useMutation({
    mutationFn: () => withStepUp(() => apiClient.request('totpEnrol')),
  });
  const confirm = useMutation({
    mutationFn: (code: string) =>
      withStepUp(() => apiClient.request('totpEnrolConfirm', { body: { code } })),
    onSuccess: () => setTotpEnabled(true),
  });
  const disable = useMutation({
    mutationFn: (proof: TotpCodeOrRecoveryRequest) =>
      withStepUp(() => apiClient.request('totpDisable', { body: proof })),
    onSuccess: () => setTotpEnabled(false),
  });
  const regenerate = useMutation({
    mutationFn: (code: string) =>
      withStepUp(() => apiClient.request('totpRecoveryCodes', { body: { code } })),
  });

  return { enrol, confirm, disable, regenerate };
}
