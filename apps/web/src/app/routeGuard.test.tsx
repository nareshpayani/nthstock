import { ACCESS_TOKEN_TTL_SEC, DEV_OTP } from '@nthstock/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer, TEST_API_ORIGIN } from '@/mocks/node';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn } from '@/test/session';
import { createSessionApiClient, ensureSession } from '@/shared/lib/sessionClient';
import { useSessionStore } from '@/shared/lib/sessionStore';

// A controllable clock for the mock auth backend, so the 15-minute access token can expire.
let now = Date.parse('2026-09-25T04:00:00.000Z');
const { server, adapter } = createMockServer({ auth: { now: () => now } });
const paths: string[] = [];
server.events.on('request:start', ({ request }) => {
  paths.push(new URL(request.url).pathname);
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  resetSession();
  paths.length = 0;
  window.localStorage.clear();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

let mobiles = 0;
/** A fresh browser (own origin, so its cookies stay apart) that has logged in with an OTP. */
async function loggedIn() {
  mobiles += 1;
  const apiClient = createSessionApiClient({
    baseUrl: TEST_API_ORIGIN.replace('//', `//u${String(mobiles)}.`),
  });
  const mobile = `96${String(mobiles).padStart(8, '0')}`;
  const { requestId } = await apiClient.request('otpRequest', { body: { mobile } });
  const session = await apiClient.request('otpVerify', {
    body: { requestId, mobile, otp: DEV_OTP },
  });
  useSessionStore.getState().setSession(session);
  paths.length = 0;
  return { apiClient, session };
}

describe('silent refresh on 401 (T-089)', () => {
  it('an expired access token refreshes transparently and the call succeeds', async () => {
    const { apiClient, session } = await loggedIn();
    now += (ACCESS_TOKEN_TTL_SEC + 60) * 1000;

    const current = await apiClient.request('sessionGet');

    expect(current.user.id).toBe(session.user.id);
    expect(paths).toEqual(['/v1/auth/session', '/v1/auth/refresh', '/v1/auth/session']);
    // The rotated session (new CSRF token) is what the store now holds.
    expect(useSessionStore.getState().session?.csrfToken).toBe(current.csrfToken);
  });

  it('concurrent 401s share one refresh', async () => {
    const { apiClient } = await loggedIn();
    now += (ACCESS_TOKEN_TTL_SEC + 60) * 1000;

    await Promise.all([apiClient.request('sessionGet'), apiClient.request('sessionGet')]);

    expect(paths.filter((p) => p === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('a failed refresh ends the session and the 401 reaches the caller', async () => {
    const { apiClient } = await loggedIn();
    await apiClient.request('logout');
    useSessionStore.getState().setSession((await loggedIn()).session); // a stale in-memory copy
    paths.length = 0;

    await expect(apiClient.request('sessionGet')).rejects.toMatchObject({ status: 401 });
    expect(paths).toEqual(['/v1/auth/session', '/v1/auth/refresh']);
    expect(useSessionStore.getState().status).toBe('anonymous');
  });

  it('ensureSession restores the session from the refresh cookie on a new page load', async () => {
    const { apiClient, session } = await loggedIn();
    resetSession();

    const restored = await ensureSession(apiClient);

    expect(restored?.user.id).toBe(session.user.id);
    expect(useSessionStore.getState().status).toBe('authenticated');
  });
});

describe('route guard (T-089)', () => {
  it('unauthenticated /orders goes to /login?redirect=/orders', async () => {
    const apiClient = createSessionApiClient({ baseUrl: 'http://anon.api.test' });
    const { router } = renderApp('/orders', { apiClient });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Log in to nthstock' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/orders' });
    expect(router.state.location.href).toBe('/login?redirect=%2Forders');
  });

  it('a reload with a live refresh cookie opens the guarded page', async () => {
    const { apiClient } = await loggedIn();
    resetSession();

    renderApp('/orders', { apiClient });

    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
  });

  it('when the session ends on a guarded page, it goes to /login with a way back', async () => {
    signIn();
    const { router } = renderApp('/funds');
    await screen.findByRole('heading', { level: 1, name: 'Funds' });

    act(() => useSessionStore.getState().clearSession());

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ redirect: '/funds' });
  });

  it('/login while logged in goes straight to the redirect target', async () => {
    signIn();
    const { router } = renderApp('/login?redirect=%2Fpositions');
    await waitFor(() => expect(router.state.location.pathname).toBe('/positions'));
  });
});
