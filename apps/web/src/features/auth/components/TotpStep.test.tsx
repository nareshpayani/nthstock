import type { ApiClient } from '@nthstock/apiClient';
import { CONSENT_POLICY_VERSION, DEV_OTP } from '@nthstock/contracts';
import { base32Decode, totpCode } from '@nthstock/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn } from '@/test/session';
import { createSessionApiClient } from '@/shared/lib/sessionClient';

// The MSW auth backend on a hand-moved clock, so the test computes the codes it expects.
let now = Date.parse('2026-11-02T04:00:00.000Z');
const { server, adapter } = createMockServer({ auth: { now: () => now } });

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  resetSession();
  window.localStorage.clear();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

let browsers = 0;

/** A user with two-factor on, logged out again; resolves to its secret and recovery codes. */
async function twoFactorUser() {
  browsers += 1;
  const apiClient: ApiClient = createSessionApiClient({
    baseUrl: `http://b${String(browsers)}.totp.test`,
  });
  const mobile = `97${String(browsers).padStart(8, '0')}`;
  const { requestId } = await apiClient.request('otpRequest', { body: { mobile } });
  signIn(
    await apiClient.request('otpVerify', {
      body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
    }),
  );
  await apiClient.request('pinSet', { body: { pin: '4821', confirmPin: '4821' } });
  await apiClient.request('stepUp', { body: { pin: '4821' } });
  const { setupKey } = await apiClient.request('totpEnrol');
  const secret = base32Decode(setupKey);
  const { codes } = await apiClient.request('totpEnrolConfirm', {
    body: { code: await totpCode(secret, now) },
  });
  await apiClient.request('logout');
  resetSession();
  window.localStorage.clear(); // no trusted-device hint: the login starts at the mobile number
  // Past the OTP resend throttle, and into the next TOTP step.
  now += 31_000;
  return { apiClient, mobile, secret, codes };
}

async function throughOtp(mobile: string) {
  fireEvent.change(await screen.findByLabelText('Mobile number'), { target: { value: mobile } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Get OTP' }));
  await screen.findByRole('heading', { level: 1, name: 'Enter the OTP' });
  typeCode('One-time password', DEV_OTP);
  await screen.findByRole('heading', { level: 1, name: 'Two-factor authentication' });
}

function typeCode(group: string, code: string) {
  const boxes = within(screen.getByRole('group', { name: group })).getAllByLabelText(/^Digit/);
  fireEvent.change(boxes[0] as HTMLElement, { target: { value: code } });
}

describe('login code step (NSTOCK-0220)', () => {
  it('asks for the authenticator code after the OTP, counts wrong codes, then logs in', async () => {
    const { apiClient, mobile, secret } = await twoFactorUser();
    const { router } = renderApp('/login?redirect=/orders', { apiClient });
    await throughOtp(mobile);

    typeCode('Authentication code', '000000');
    expect(await screen.findByText('That code is not right. 4 attempts left.')).toBeInTheDocument();

    typeCode('Authentication code', await totpCode(secret, now));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders'));
    // End on the page itself: a request still in flight would 401 after afterEach resets the
    // session, refresh, and leave its session (and CSRF token) for the next test.
    await screen.findByRole('heading', { level: 1, name: 'Orders' });
  });

  it('takes a recovery code instead, typed with spaces and in lower case', async () => {
    const { apiClient, mobile, codes } = await twoFactorUser();
    const { router } = renderApp('/login', { apiClient });
    await throughOtp(mobile);

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await screen.findByRole('heading', { level: 1, name: 'Use a recovery code' });
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: (codes[0] ?? '').replaceAll('-', ' ').toLowerCase() },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    await screen.findByRole('heading', { level: 1, name: /^Good/ });
  });

  it('after five wrong codes the sign-in ends and offers to start again', async () => {
    const { apiClient, mobile } = await twoFactorUser();
    renderApp('/login', { apiClient });
    await throughOtp(mobile);

    for (let left = 4; left >= 1; left -= 1) {
      typeCode('Authentication code', '000000');
      await screen.findByText(
        `That code is not right. ${String(left)} ${left === 1 ? 'attempt' : 'attempts'} left.`,
      );
    }
    typeCode('Authentication code', '000000');
    expect(await screen.findByText(/This sign-in has ended/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log in again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Log in to nthstock' }),
    ).toBeInTheDocument();
  });
});
