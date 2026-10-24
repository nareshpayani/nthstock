import type { ApiClient } from '@nthstock/apiClient';
import { DEV_OTP } from '@nthstock/contracts';
import { base32Decode, totpCode } from '@nthstock/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn } from '@/test/session';
import { createSessionApiClient } from '@/shared/lib/sessionClient';
import { useSessionStore } from '@/shared/lib/sessionStore';

// The MSW auth backend on a hand-moved clock: codes are computed for the same instant.
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
const PIN = '4821';

/** A fresh browser, logged in with an OTP and a PIN set, its session in the store. */
async function loggedIn(): Promise<{ apiClient: ApiClient; mobile: string }> {
  browsers += 1;
  const apiClient = createSessionApiClient({
    baseUrl: `http://b${String(browsers)}.security.test`,
  });
  const mobile = `96${String(browsers).padStart(8, '0')}`;
  const { requestId } = await apiClient.request('otpRequest', { body: { mobile } });
  const session = signIn(
    await apiClient.request('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } }),
  );
  await apiClient.request('pinSet', { body: { pin: PIN, confirmPin: PIN } });
  signIn({ ...session, user: { ...session.user, pinSet: true } });
  return { apiClient, mobile };
}

function typeCode(container: HTMLElement, group: string, code: string) {
  const boxes = within(container).getAllByRole('group', { name: group });
  const box = within(boxes[0] as HTMLElement).getAllByLabelText(/^Digit/)[0];
  fireEvent.change(box as HTMLElement, { target: { value: code } });
}

async function turnOn(): Promise<{ secret: Uint8Array; codes: string[] }> {
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));

  // Step-up first: the PIN.
  const stepUp = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  typeCode(stepUp, 'Your PIN', PIN);
  fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));

  // Then the wizard: the QR code and the setup key.
  const setup = await screen.findByRole('dialog', { name: 'Turn on two-factor authentication' });
  expect(
    await within(setup).findByRole('img', { name: 'QR code for your authenticator app' }),
  ).toBeInTheDocument();
  const key = within(setup).getByTestId('totp-setup-key').textContent ?? '';
  expect(key).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
  const secret = base32Decode(key);
  fireEvent.click(within(setup).getByRole('button', { name: 'Next' }));

  typeCode(setup, 'Code from your authenticator app', await totpCode(secret, now));
  const list = await within(setup).findByRole('list', { name: 'Recovery codes' });
  const codes = within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
  expect(codes).toHaveLength(10);

  const done = within(setup).getByRole('button', { name: 'Done' });
  expect(done).toBeDisabled();
  fireEvent.click(within(setup).getByRole('checkbox', { name: 'I have saved these codes' }));
  fireEvent.click(done);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  return { secret, codes };
}

describe('security settings: two-factor (NSTOCK-0221)', () => {
  it('turns two-factor on behind a step-up: QR code, code, recovery codes saved', async () => {
    const { apiClient } = await loggedIn();
    renderApp('/settings/security', { apiClient });
    expect(await screen.findByLabelText('Two-factor authentication is off')).toBeInTheDocument();

    await turnOn();

    expect(await screen.findByLabelText('Two-factor authentication is on')).toBeInTheDocument();
    expect(useSessionStore.getState().session?.user.totpEnabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('a wrong code in the wizard says so and lets the user try again', async () => {
    const { apiClient } = await loggedIn();
    renderApp('/settings/security', { apiClient });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    typeCode(stepUp, 'Your PIN', '0000');
    fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));
    expect(await within(stepUp).findByText('Incorrect PIN. 4 attempts left.')).toBeInTheDocument();
    typeCode(stepUp, 'Your PIN', PIN);
    fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));

    const setup = await screen.findByRole('dialog', { name: 'Turn on two-factor authentication' });
    fireEvent.click(await within(setup).findByRole('button', { name: 'Next' }));
    typeCode(setup, 'Code from your authenticator app', '000000');
    expect(
      await within(setup).findByText(
        'That code is not right. Wait for the next code in the app and try again.',
      ),
    ).toBeInTheDocument();
  });

  it('turns it off with a recovery code; a lapsed step-up is asked for, with a code', async () => {
    const { apiClient } = await loggedIn();
    renderApp('/settings/security', { apiClient });
    const { secret, codes } = await turnOn();

    // Later: the server's step-up has lapsed (its clock moved on), so the call answers 403, the
    // step-up dialog opens over the form, and the call is retried once it is confirmed.
    now += 11 * 60_000;
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    const off = await screen.findByRole('dialog', { name: 'Turn off two-factor authentication' });
    fireEvent.click(within(off).getByRole('button', { name: 'Use a recovery code instead' }));
    fireEvent.change(within(off).getByLabelText('Recovery code'), {
      target: { value: (codes[0] ?? '').toLowerCase() },
    });
    fireEvent.click(within(off).getByRole('button', { name: 'Turn off' }));

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    typeCode(stepUp, 'Your PIN', PIN);
    typeCode(stepUp, 'Code from your authenticator app', await totpCode(secret, now));
    fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByLabelText('Two-factor authentication is off')).toBeInTheDocument();
    expect(useSessionStore.getState().session?.user.totpEnabled).toBe(false);
  });
});
