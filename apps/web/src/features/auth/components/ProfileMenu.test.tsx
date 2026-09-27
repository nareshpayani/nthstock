import { DEV_OTP } from '@nthstock/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_DEMO_USER } from '@/mocks/handlers/auth';
import { createMockServer } from '@/mocks/node';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn, testSession } from '@/test/session';
import { createSessionApiClient } from '@/shared/lib/sessionClient';
import { useSessionStore } from '@/shared/lib/sessionStore';
import { KycBadge } from './ProfileMenu';

const { server, adapter } = createMockServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  resetSession();
  window.localStorage.clear();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

async function openMenu(name: RegExp | string) {
  const trigger = await screen.findByRole('button', { name });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

describe('profile menu (T-090)', () => {
  it('shows the name, masked mobile and mocked KYC badge; logout clears the Query cache and lands on /login', async () => {
    const apiClient = createSessionApiClient({ baseUrl: 'http://profile.test' });
    const { mobile } = MOCK_DEMO_USER;
    const { requestId } = await apiClient.request('otpRequest', { body: { mobile } });
    signIn(await apiClient.request('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } }));

    const { router, queryClient } = renderApp('/orders', { apiClient });
    await screen.findByRole('heading', { level: 1, name: 'Orders' });
    queryClient.setQueryData(['funds', 'summary', {}], { private: true });

    const menu = await openMenu('Account: Demo Investor');
    expect(within(menu).getByText('Demo Investor')).toBeInTheDocument();
    expect(within(menu).getByText('+91 ******0001')).toBeInTheDocument();
    expect(within(menu).getByText('KYC verified')).toBeInTheDocument();
    expect(within(menu).getByText('Mock KYC for paper trading')).toBeInTheDocument();
    // Only the masked number is ever shown.
    expect(menu).not.toHaveTextContent(mobile);

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Log out/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    // No cached data outlives the session. Components still on screen until the navigation may
    // re-register their (now disabled, empty) queries, so count the entries that hold data.
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.data !== undefined),
    ).toHaveLength(0);
    expect(useSessionStore.getState().status).toBe('anonymous');
    await screen.findByRole('heading', { level: 1, name: 'Log in to nthstock' });
    // The server session is gone too: the refresh cookie no longer works.
    await expect(apiClient.request('sessionRefresh')).rejects.toMatchObject({ status: 401 });
  });

  it('a user without a name gets a generic label and an icon', async () => {
    signIn(testSession({ name: null, kycStatus: 'NOT_STARTED' }));
    renderApp('/dashboard');
    const menu = await openMenu('Account: nthstock investor');
    expect(within(menu).getByText('KYC not started')).toBeInTheDocument();
  });
});

describe('KycBadge', () => {
  it.each([
    ['VERIFIED', 'KYC verified'],
    ['PENDING', 'KYC pending'],
    ['NOT_STARTED', 'KYC not started'],
  ] as const)('%s reads "%s"', (status, text) => {
    render(<KycBadge status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
