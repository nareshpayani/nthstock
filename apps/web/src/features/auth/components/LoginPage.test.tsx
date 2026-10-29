import type { ApiClient } from '@nthstock/apiClient';
import { CONSENT_POLICY_VERSION, DEV_OTP, OTP_RESEND_AFTER_SEC } from '@nthstock/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn } from '@/test/session';
import {
  DEMO_PENDING_STORAGE_KEY,
  setDemoStarter,
  type DemoStart,
} from '@/shared/lib/demoSimulator';
import { createSessionApiClient } from '@/shared/lib/sessionClient';
import { readTrustedDevice } from '../store/trustedDevice';

// The demo tests land on a stock page; jsdom has no canvas, and a real chart throws after teardown.
vi.mock('lightweight-charts', () => import('@/test/chartsMock'));

// The mock auth backend's clock, moved on by hand past the 30 s OTP resend throttle.
let now = Date.parse('2026-09-25T04:00:00.000Z');
// Orders share that clock and trade at any hour, so the demo position never depends on the time.
const { server, adapter } = createMockServer({
  auth: { now: () => now },
  orders: { now: () => now, marketHours: 'alwaysOpen' },
});
const paths: string[] = [];
server.events.on('request:start', ({ request }) => {
  paths.push(new URL(request.url).pathname);
});

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  resetSession();
  paths.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

let browsers = 0;
/** A fresh browser: its own API origin, so the mock's cookies for it stay apart. */
function newBrowser(): { apiClient: ApiClient; mobile: string } {
  browsers += 1;
  return {
    apiClient: createSessionApiClient({ baseUrl: `http://b${String(browsers)}.login.test` }),
    mobile: `95${String(browsers).padStart(8, '0')}`,
  };
}

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

function enterMobile(mobile: string, { consent = true } = {}) {
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: mobile } });
  if (consent) fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Get OTP' }));
}

/** Types a whole code into a group of digit boxes (as autofill or paste does). */
function typeCode(group: string, code: string) {
  const boxes = within(screen.getByRole('group', { name: group })).getAllByLabelText(/^Digit/);
  fireEvent.change(boxes[0] as HTMLElement, { target: { value: code } });
}

async function reachOtp(mobile: string) {
  enterMobile(mobile);
  await heading('Enter the OTP');
}

describe('mobile number screen (T-086)', () => {
  it('an invalid number shows an inline error and sends nothing', async () => {
    const { apiClient } = newBrowser();
    renderApp('/login', { apiClient });
    await heading('Log in to nthstock');

    enterMobile('12345');

    expect(
      await screen.findByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Mobile number')).toHaveAccessibleDescription(
      /Enter a 10-digit mobile number/,
    );
    expect(paths).not.toContain('/v1/auth/otp/request');
  });

  it('requires the DPDP consent box', async () => {
    const { apiClient, mobile } = newBrowser();
    renderApp('/login', { apiClient });
    await heading('Log in to nthstock');

    enterMobile(mobile, { consent: false });

    expect(
      await screen.findByText('Tick the box to agree before we send an OTP.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /I agree/ })).toHaveAccessibleDescription(
      'Tick the box to agree before we send an OTP.',
    );
    expect(paths).not.toContain('/v1/auth/otp/request');
  });

  it('a valid number (typed with +91 and spaces) calls the OTP route and opens the OTP step', async () => {
    const { apiClient, mobile } = newBrowser();
    renderApp('/login', { apiClient });
    await heading('Log in to nthstock');

    enterMobile(`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`);

    await heading('Enter the OTP');
    expect(paths).toContain('/v1/auth/otp/request');
    expect(
      screen.getByText(`We sent a 6-digit code to +91 ${mobile.slice(0, 5)} ${mobile.slice(5)}.`),
    ).toBeInTheDocument();
    // The dev OTP is discoverable in mock mode.
    expect(screen.getByText(`Mock mode: the OTP is always ${DEV_OTP}.`)).toBeInTheDocument();
  });
});

describe('OTP screen (T-087)', () => {
  it('a wrong OTP shows the error and clears the boxes; Change number goes back', async () => {
    const { apiClient, mobile } = newBrowser();
    renderApp('/login', { apiClient });
    await heading('Log in to nthstock');
    await reachOtp(mobile);

    typeCode('One-time password', '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect OTP. 4 attempts left.');
    const boxes = within(
      screen.getByRole('group', { name: 'One-time password' }),
    ).getAllByLabelText(/^Digit/);
    expect(boxes.map((box) => (box as HTMLInputElement).value).join('')).toBe('');
    expect(screen.getByRole('button', { name: /Resend OTP in 0:\d\d/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Change number' }));
    await heading('Log in to nthstock');
    expect(screen.getByLabelText('Mobile number')).toHaveValue(mobile);
  });

  it('after 3 wrong OTPs the mock CAPTCHA is required, then the right OTP logs in', async () => {
    const { apiClient, mobile } = newBrowser();
    const { router } = renderApp('/login?redirect=%2Forders', { apiClient });
    await heading('Log in to nthstock');
    await reachOtp(mobile);

    for (const left of [4, 3, 2]) {
      typeCode('One-time password', '000000');
      await screen.findByText(`Incorrect OTP. ${String(left)} attempts left.`);
    }
    const captcha = screen.getByRole('checkbox', { name: /not a robot/ });
    typeCode('One-time password', DEV_OTP);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tick the CAPTCHA box');

    fireEvent.click(captcha);
    typeCode('One-time password', DEV_OTP);
    // A new user has no PIN yet: PIN setup comes first.
    await heading('Set a login PIN');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders'));
    // Let the page load while this test still owns the session store: a request left in flight
    // would refresh into the next test's session.
    await heading('Orders');
  });
});

describe('Try demo (REQ-DEL-02)', () => {
  it('one tap logs in as the demo user and opens the instrument page in demo mode', async () => {
    const start = vi.fn((): DemoStart => 'ready');
    setDemoStarter(start);
    onTestFinished(() => setDemoStarter(null));
    const { apiClient } = newBrowser();
    const { router } = renderApp('/login', { apiClient });
    await heading('Log in to nthstock');

    fireEvent.click(screen.getByRole('button', { name: 'Try demo' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/RELIANCE'));
    expect(paths).toContain('/v1/auth/otp/verify');
    // The Demo simulator comes with Try demo, not only with ?demo=1.
    expect(start).toHaveBeenCalledOnce();
    await heading(/Reliance/);
  });
});

describe('Try demo outside demo mode (TFC-12)', () => {
  it('reloads with the demo account first, sending nothing yet', async () => {
    setDemoStarter(() => 'reloading');
    onTestFinished(() => setDemoStarter(null));
    const { apiClient } = newBrowser();
    renderApp('/login', { apiClient });
    await heading('Log in to nthstock');
    paths.length = 0;

    fireEvent.click(screen.getByRole('button', { name: 'Try demo' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Starting/ })).toBeDisabled());
    expect(paths).not.toContain('/v1/auth/otp/request');
  });

  it('carries on after the reload without a second tap', async () => {
    setDemoStarter(() => 'ready');
    onTestFinished(() => setDemoStarter(null));
    // Past the OTP resend throttle for the demo mobile, which the test above used.
    now += (OTP_RESEND_AFTER_SEC + 1) * 1000;
    window.sessionStorage.setItem(DEMO_PENDING_STORAGE_KEY, '1');
    const { apiClient } = newBrowser();
    const { router } = renderApp('/login', { apiClient });

    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/RELIANCE'));
    expect(window.sessionStorage.getItem(DEMO_PENDING_STORAGE_KEY)).toBeNull();
    await heading(/Reliance/);
  });
});

describe('Try demo after a reload that did not start demo mode', () => {
  it('shows an error instead of reloading again', async () => {
    const start = vi.fn((): DemoStart => 'reloading');
    setDemoStarter(start);
    onTestFinished(() => setDemoStarter(null));
    window.sessionStorage.setItem(DEMO_PENDING_STORAGE_KEY, '1');
    const { apiClient } = newBrowser();
    renderApp('/login', { apiClient });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Try demo' })).toBeEnabled();
  });
});

describe('PIN setup, PIN entry and lockout (T-088)', () => {
  it('first login sets a PIN; the trusted browser then goes straight to PIN entry; 5 wrong PINs lock; OTP unlocks', async () => {
    const { apiClient, mobile } = newBrowser();
    const first = renderApp('/login?redirect=%2Forders', { apiClient });
    await heading('Log in to nthstock');
    await reachOtp(mobile);
    typeCode('One-time password', DEV_OTP);

    await heading('Set a login PIN');
    typeCode('New PIN', '4821');
    typeCode('Confirm PIN', '4829');
    fireEvent.click(screen.getByRole('button', { name: 'Set PIN' }));
    expect(await screen.findByText('PINs do not match.')).toBeInTheDocument();
    typeCode('Confirm PIN', '4821');
    fireEvent.click(screen.getByRole('button', { name: 'Set PIN' }));
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/orders'));
    expect(readTrustedDevice()).toEqual({
      name: null,
      mobileMasked: `******${mobile.slice(-4)}`,
    });

    // Log out and load the login page again, as after a reload.
    await apiClient.request('logout');
    first.unmount();
    resetSession();
    const second = renderApp('/login', { apiClient });

    await heading('Welcome back');
    expect(
      screen.getByText(`Enter your 4-digit PIN for +91 ******${mobile.slice(-4)}.`),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument();

    for (const left of [4, 3, 2, 1]) {
      typeCode('PIN', '0000');
      await screen.findByText(
        `Incorrect PIN. ${String(left)} ${left === 1 ? 'attempt' : 'attempts'} left.`,
      );
    }
    typeCode('PIN', '0000');
    await heading('PIN locked');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock with OTP' }));

    await heading('Unlock your PIN');
    now += (OTP_RESEND_AFTER_SEC + 1) * 1000;
    enterMobile(mobile);
    await heading('Enter the OTP');
    typeCode('One-time password', DEV_OTP);
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/dashboard'));
  });
});

describe('account deletion in progress (NSTOCK-0233)', () => {
  it('an OTP login for a deleted account shows when its data is erased, in IST', async () => {
    const { apiClient, mobile } = newBrowser();
    const { requestId } = await apiClient.request('otpRequest', { body: { mobile } });
    signIn(
      await apiClient.request('otpVerify', {
        body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
      }),
    );
    await apiClient.request('pinSet', { body: { pin: '4821', confirmPin: '4821' } });
    await apiClient.request('stepUp', { body: { pin: '4821' } });
    await apiClient.request('accountDelete', { body: { confirm: 'DELETE' } });
    resetSession();
    window.localStorage.clear();

    now += (OTP_RESEND_AFTER_SEC + 1) * 1000;
    renderApp('/login', { apiClient });
    await heading('Log in to nthstock');
    await reachOtp(mobile);
    typeCode('One-time password', DEV_OTP);

    await heading('Account deletion in progress');
    // 30 days after 25 Sept 2026 (plus the throttle wait), in IST.
    expect(screen.getByText(/Its data is erased for good on 25 Oct 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use another number' }));
    await heading('Log in to nthstock');
  });
});
