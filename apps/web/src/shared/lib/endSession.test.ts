import { createApiClient } from '@nthstock/apiClient';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSession, signIn } from '@/test/session';
import { endSession } from './sessionClient';
import { useSessionStore } from './sessionStore';

afterEach(() => resetSession());

/** A client whose logout answers with `status`, or fails as a network error for 0. */
function logoutAnswering(status: number) {
  return createApiClient({
    baseUrl: 'http://logout.test',
    fetch: () =>
      status === 0
        ? Promise.reject(new TypeError('offline'))
        : Promise.resolve(
            new Response(
              JSON.stringify(
                status === 200 ? { ok: true } : { error: { code: 'X', message: 'no' } },
              ),
              { status, headers: { 'content-type': 'application/json' } },
            ),
          ),
  });
}

function cachedQueries() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['holdings'], { items: [] });
  return queryClient;
}

describe('endSession (NSTOCK-0466)', () => {
  it.each([
    ['the server ends it', 200],
    ['the server already holds none (401)', 401],
  ])('ends the session and empties the cache when %s', async (_, status) => {
    signIn();
    const queryClient = cachedQueries();
    await endSession(logoutAnswering(status), queryClient);
    expect(useSessionStore.getState().session).toBeNull();
    expect(queryClient.getQueryData(['holdings'])).toBeUndefined();
  });

  it.each([
    ['a stale CSRF token (403)', 403],
    ['a server error (500)', 500],
    ['no network', 0],
  ])('rejects and keeps the session and the cache on %s', async (_, status) => {
    signIn();
    const queryClient = cachedQueries();
    await expect(endSession(logoutAnswering(status), queryClient)).rejects.toBeDefined();
    expect(useSessionStore.getState().session).not.toBeNull();
    expect(queryClient.getQueryData(['holdings'])).toEqual({ items: [] });
  });
});
