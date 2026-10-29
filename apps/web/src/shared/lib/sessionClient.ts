import {
  createApiClient,
  isApiError,
  type ApiClient,
  type ApiClientOptions,
} from '@nthstock/apiClient';
import type { Session } from '@nthstock/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { gateFetch } from './networkGate';
import { knownSignedOut, useSessionStore } from './sessionStore';

/**
 * The CSRF header value before a session exists (OTP, PIN login, the refresh after a reload).
 * Any non-empty value is accepted then; see `AUTH_CSRF_HEADER` in packages/contracts.
 */
const PRE_SESSION_CSRF = 'pre-session';

let refreshing: Promise<boolean> | null = null;

/**
 * One silent refresh (T-089): `POST /v1/auth/refresh` with the httpOnly refresh cookie. Concurrent
 * callers share the same request, so a burst of 401s rotates the refresh token once. Resolves
 * whether a session is now held.
 */
function refreshSession(apiClient: ApiClient): Promise<boolean> {
  refreshing ??= apiClient
    .request('sessionRefresh')
    .then(
      (session) => {
        useSessionStore.getState().setSession(session);
        return true;
      },
      (error: unknown) => {
        const { status, clearSession } = useSessionStore.getState();
        // No answer at all says nothing about the session: keep one we hold, but settle the
        // first check of the page load so guards can decide.
        if (!(isApiError(error) && error.kind === 'network' && status === 'authenticated')) {
          clearSession();
        }
        return false;
      },
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * The current session, restoring it with one refresh on the first call of a page load. A browser
 * known to be signed out skips that refresh, which could only answer 401.
 */
export async function ensureSession(apiClient: ApiClient): Promise<Session | null> {
  const { status, clearSession } = useSessionStore.getState();
  if (status === 'unknown') {
    if (knownSignedOut()) clearSession();
    else await refreshSession(apiClient);
  }
  return useSessionStore.getState().session;
}

export type SessionApiClientOptions = Omit<ApiClientOptions, 'csrfToken' | 'onUnauthorized'> & {
  /**
   * msw mode (T-169): every request waits for this, the MSW worker's start, so the page renders
   * first. As a function it runs before each request (the worker keep-alive check). Omitted in
   * api mode.
   */
  ready?: Promise<unknown> | (() => Promise<unknown>);
};

/**
 * The app's REST client: sends the session's CSRF token (or the pre-session value) and, when a
 * user route answers 401 because the 15-minute access token expired, refreshes once and retries.
 */
export function createSessionApiClient({
  ready,
  ...options
}: SessionApiClientOptions = {}): ApiClient {
  const apiClient: ApiClient = createApiClient({
    ...options,
    ...(ready ? { fetch: gateFetch(ready, options.fetch) } : {}),
    csrfToken: () => useSessionStore.getState().session?.csrfToken ?? PRE_SESSION_CSRF,
    onUnauthorized: () => refreshSession(apiClient),
  });
  return apiClient;
}

/**
 * Logs out: revokes the session on the server, then forgets it in memory and drops every cached
 * query so no user data outlives the session. A 401 means the server already holds no session,
 * so that still ends it here. Any other failure (offline, 5xx, a 403 for a stale CSRF token) rejects
 * and keeps the session: the httpOnly cookie is still valid and the next page load would restore it, so saying
 * "logged out" would be false on a shared device (NSTOCK-0466 review).
 * The trusted-device cookie stays, so the next login on this browser can use the PIN.
 */
export async function endSession(apiClient: ApiClient, queryClient: QueryClient): Promise<void> {
  try {
    await apiClient.request('logout');
  } catch (error) {
    if (!(isApiError(error) && error.status === 401)) throw error;
  }
  useSessionStore.getState().clearSession();
  queryClient.clear();
}
