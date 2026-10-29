import { ApiError, type ApiClient } from '@nthstock/apiClient';
import type { Session } from '@nthstock/contracts';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endSession } from './sessionClient';
import { initialSessionState, useSessionStore } from './sessionStore';

const SESSION = { csrfToken: 'csrf' } as unknown as Session;

function clientRejecting(error?: unknown): ApiClient {
  const request = vi.fn(() => (error === undefined ? Promise.resolve() : Promise.reject(error)));
  return { request } as unknown as ApiClient;
}

function httpError(status: number): ApiError {
  return new ApiError({
    kind: 'http',
    status,
    code: 'INTERNAL_ERROR',
    message: 'status ' + String(status),
  });
}

describe('endSession', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    useSessionStore.setState({ ...initialSessionState });
    useSessionStore.getState().setSession(SESSION);
    queryClient = new QueryClient();
    queryClient.setQueryData(['k'], 1);
  });

  it.each([
    ['success', undefined],
    ['401', httpError(401)],
  ])('clears the session and the cache on %s', async (_name, error) => {
    await endSession(clientRejecting(error), queryClient);
    expect(useSessionStore.getState().session).toBeNull();
    expect(queryClient.getQueryData(['k'])).toBeUndefined();
  });

  it.each([
    ['403', httpError(403)],
    ['500', httpError(500)],
    [
      'network',
      new ApiError({ kind: 'network', status: 0, code: 'SERVICE_UNAVAILABLE', message: 'offline' }),
    ],
  ])('rejects and keeps the session and cache on %s', async (_name, error) => {
    await expect(endSession(clientRejecting(error), queryClient)).rejects.toBe(error);
    expect(useSessionStore.getState().session).toBe(SESSION);
    expect(queryClient.getQueryData(['k'])).toBe(1);
  });
});
