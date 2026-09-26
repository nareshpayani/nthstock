// @vitest-environment node
import { ApiError, createApiClient, type ApiClient } from '@nthstock/apiClient';
import {
  ACCESS_TOKEN_TTL_SEC,
  AUTH_COOKIES,
  DEV_CAPTCHA_TOKEN,
  DEV_OTP,
  OTP_RESEND_AFTER_SEC,
  routes,
  type RouteName,
  type Session,
} from '@nthstock/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../node';
import { MOCK_DEMO_USER, MSW_SESSION_COOKIE } from './auth';

let now = Date.parse('2026-09-25T04:00:00.000Z');
const { server, adapter } = createMockServer({ auth: { now: () => now } });
const covered = new Set<RouteName>();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
  adapter.dispose();
  // Every auth route answered at least once with a body its response schema accepts.
  expect([...covered].sort()).toEqual(
    [
      'logout',
      'otpRequest',
      'otpVerify',
      'pinSet',
      'pinVerify',
      'sessionGet',
      'sessionRefresh',
    ].sort(),
  );
});

/**
 * One simulated browser: its own origin (so MSW's cookie store keeps its cookies apart) and the
 * CSRF token of its current session, as the web app will hold it.
 */
let browsers = 0;
function browser() {
  browsers += 1;
  const origin = `http://b${String(browsers)}.api.test`;
  let csrf: string | null = null;
  const client = createApiClient({ baseUrl: origin, csrfToken: () => csrf ?? 'pre-session' });
  /** A call whose success is also checked against the route's response schema. */
  const call: ApiClient['request'] = async (name, ...args) => {
    const body = await client.request(name, ...args);
    expect(routes[name].response.safeParse(body).success).toBe(true);
    covered.add(name);
    return body;
  };
  return {
    origin,
    client,
    call,
    useSession(session: Session) {
      csrf = session.csrfToken;
    },
    async login(mobile: string): Promise<Session> {
      const { requestId } = await client.request('otpRequest', { body: { mobile } });
      const session = await client.request('otpVerify', {
        body: { requestId, mobile, otp: DEV_OTP },
      });
      csrf = session.csrfToken;
      return session;
    },
  };
}

/** Awaits a call expected to fail and returns its ApiError. */
async function failure(pending: Promise<unknown>): Promise<ApiError> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

let mobiles = 0;
const nextMobile = () => {
  mobiles += 1;
  return `97${String(mobiles).padStart(8, '0')}`;
};

describe('MSW auth handlers (T-084)', () => {
  it('OTP request answers schema-valid and throttles a resend within 30 s', async () => {
    const b = browser();
    const mobile = nextMobile();
    await b.call('otpRequest', { body: { mobile } });

    const throttled = await failure(b.client.request('otpRequest', { body: { mobile } }));
    expect(throttled).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(throttled.details).toEqual({ retryAfterSec: OTP_RESEND_AFTER_SEC });

    now += OTP_RESEND_AFTER_SEC * 1000;
    await b.call('otpRequest', { body: { mobile } });
  });

  it('OTP verify logs in with the dev OTP and sets one httpOnly SameSite=Strict session cookie', async () => {
    const b = browser();
    const mobile = nextMobile();
    const { requestId } = await b.client.request('otpRequest', { body: { mobile } });

    const response = await fetch(`${b.origin}${routes.otpVerify.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'pre-session' },
      body: JSON.stringify({ requestId, mobile, otp: DEV_OTP }),
    });

    expect(response.status).toBe(200);
    const session = routes.otpVerify.response.parse(await response.json());
    expect(session.user.mobileMasked).toBe(`******${mobile.slice(-4)}`);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${MSW_SESSION_COOKIE}=[^;]+; Max-Age=2592000; Path=/; SameSite=Strict; HttpOnly$`,
        ),
      ),
    ]);
    covered.add('otpVerify');
  });

  it('the 3rd wrong OTP sets captchaRequired, then the dev CAPTCHA token lets the right OTP in', async () => {
    const b = browser();
    const mobile = nextMobile();
    const { requestId } = await b.client.request('otpRequest', { body: { mobile } });
    const verify = (otp: string, captchaToken?: string) =>
      b.client.request('otpVerify', {
        body: { requestId, mobile, otp, ...(captchaToken ? { captchaToken } : {}) },
      });

    const wrong = [await failure(verify('000000')), await failure(verify('000000'))];
    const third = await failure(verify('000000'));

    expect(wrong.map((e) => e.details)).toEqual([
      { attemptsLeft: 4, captchaRequired: false },
      { attemptsLeft: 3, captchaRequired: false },
    ]);
    expect(third).toMatchObject({ status: 400, code: 'OTP_INVALID' });
    expect(third.details).toEqual({ attemptsLeft: 2, captchaRequired: true });
    expect(await failure(verify(DEV_OTP))).toMatchObject({ code: 'CAPTCHA_REQUIRED' });
    expect((await verify(DEV_OTP, DEV_CAPTCHA_TOKEN)).user.mobileMasked).toMatch(/\d{4}$/);
  });

  it('logs the seeded demo user in as the same user apps/api seeds', async () => {
    const session = await browser().login(MOCK_DEMO_USER.mobile);
    expect(session.user).toMatchObject({ id: 'usr_demo', name: 'Demo Investor' });
  });

  it('session, refresh and logout follow the session cookie and the CSRF token', async () => {
    const b = browser();
    const session = await b.login(nextMobile());

    const current = await b.call('sessionGet');
    expect(current.user.id).toBe(session.user.id);
    expect(current.csrfToken).toBe(session.csrfToken);

    const refreshed = await b.call('sessionRefresh');
    expect(refreshed.accessToken).not.toBe(session.accessToken);
    b.useSession(refreshed);

    // Logout with another session's CSRF token is refused.
    const forged = createApiClient({ baseUrl: b.origin, csrfToken: () => 'forged-token-value' });
    expect(await failure(forged.request('logout'))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });

    await b.call('logout');
    expect(await failure(b.client.request('sessionGet'))).toMatchObject({ status: 401 });
    expect(await failure(b.client.request('sessionRefresh'))).toMatchObject({ status: 401 });
  });

  it('the access window closes after 15 minutes and a refresh reopens it', async () => {
    const b = browser();
    await b.login(nextMobile());

    now += ACCESS_TOKEN_TTL_SEC * 1000;
    expect(await failure(b.client.request('sessionGet'))).toMatchObject({ status: 401 });
    b.useSession(await b.call('sessionRefresh'));
    await b.call('sessionGet');
  });

  it('reusing an old session cookie on refresh revokes the whole session', async () => {
    const b = browser();
    const session = await b.login(nextMobile());
    const old = `${MSW_SESSION_COOKIE}=${session.accessToken.split('.').slice(1, 3).join('.')}`;
    await b.call('sessionRefresh');

    const reused = await fetch(`${b.origin}${routes.sessionRefresh.path}`, {
      method: 'POST',
      headers: { cookie: old, 'x-csrf-token': 'pre-session' },
    });

    expect(reused.status).toBe(401);
    expect(await failure(b.client.request('sessionGet'))).toMatchObject({ status: 401 });
    expect(await failure(b.client.request('sessionRefresh'))).toMatchObject({ status: 401 });
  });

  it('accepts the access token as a Bearer header', async () => {
    const b = browser();
    const session = await b.login(nextMobile());
    const other = browser();

    const response = await fetch(`${other.origin}${routes.sessionGet.path}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(response.status).toBe(200);
  });

  it('PIN: set trusts the device, verify logs in, 5 wrong PINs lock, a verified OTP unlocks', async () => {
    const b = browser();
    const mobile = nextMobile();
    await b.login(mobile);

    const response = await fetch(`${b.origin}${routes.pinSet.path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': (await b.client.request('sessionGet')).csrfToken,
      },
      body: JSON.stringify({ pin: '4821', confirmPin: '4821' }),
    });
    expect(response.status).toBe(200);
    expect(routes.pinSet.response.parse(await response.json()).device.trusted).toBe(true);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${AUTH_COOKIES.device}=[^;]+; Max-Age=15552000; Path=/v1/auth; SameSite=Strict; HttpOnly$`,
        ),
      ),
    ]);
    covered.add('pinSet');

    const viaPin = await b.call('pinVerify', { body: { pin: '4821' } });
    expect(viaPin.device.trusted).toBe(true);

    for (const attemptsLeft of [4, 3, 2, 1]) {
      const wrong = await failure(b.client.request('pinVerify', { body: { pin: '0000' } }));
      expect(wrong).toMatchObject({ status: 400, code: 'PIN_INVALID', details: { attemptsLeft } });
    }
    const fifth = await failure(b.client.request('pinVerify', { body: { pin: '0000' } }));
    expect(fifth).toMatchObject({ status: 423, code: 'PIN_LOCKED' });
    expect(fifth.details).toEqual({ attemptsLeft: 0, unlockWith: 'OTP' });
    expect(await failure(b.client.request('pinVerify', { body: { pin: '4821' } }))).toMatchObject({
      code: 'PIN_LOCKED',
    });

    now += OTP_RESEND_AFTER_SEC * 1000;
    const { requestId } = await b.client.request('otpRequest', {
      body: { mobile, purpose: 'UNLOCK_PIN' },
    });
    const unlocked = await b.client.request('otpVerify', {
      body: { requestId, mobile, otp: DEV_OTP },
    });
    expect(unlocked.device.id).toBe(viaPin.device.id);
    await b.call('pinVerify', { body: { pin: '4821' } });
  });

  it('PIN verify without a trusted device is 401', async () => {
    const b = browser();
    expect(await failure(b.client.request('pinVerify', { body: { pin: '4821' } }))).toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('every state-changing auth route refuses a request without the CSRF header', async () => {
    const b = browser();
    const bare = createApiClient({ baseUrl: b.origin });
    expect(
      await failure(bare.request('otpRequest', { body: { mobile: nextMobile() } })),
    ).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(await failure(bare.request('sessionRefresh'))).toMatchObject({ status: 403 });
  });
});
