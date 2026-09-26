import type { OtpPurpose, OtpVerifyRequest, Session } from '@nthstock/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { endSession } from '@/shared/lib/sessionClient';
import { useSessionStore } from '@/shared/lib/sessionStore';
import { rememberTrustedDevice } from '../store/trustedDevice';

function startSession(session: Session) {
  useSessionStore.getState().setSession(session);
  rememberTrustedDevice(session);
}

export function useRequestOtp() {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (body: { mobile: string; purpose: OtpPurpose }) =>
      apiClient.request('otpRequest', { body }),
  });
}

export function useVerifyOtp() {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (body: OtpVerifyRequest) => apiClient.request('otpVerify', { body }),
    onSuccess: startSession,
  });
}

export function useSetPin() {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (body: { pin: string; confirmPin: string }) =>
      apiClient.request('pinSet', { body }),
    onSuccess: ({ device }) => {
      const current = useSessionStore.getState().session;
      if (current) startSession({ ...current, device, user: { ...current.user, pinSet: true } });
    },
  });
}

export function useVerifyPin() {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (pin: string) => apiClient.request('pinVerify', { body: { pin } }),
    onSuccess: startSession,
  });
}

/** Logs out (T-090): ends the session, clears the Query cache and lands on /login. */
export function useLogout() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => endSession(apiClient, queryClient),
    onSettled: () => navigate({ to: '/login', replace: true }),
  });
}
