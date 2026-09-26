import { expect } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SEC,
  AuthErrorDetails,
  DEV_CAPTCHA_TOKEN,
  DEV_OTP,
  OTP_RESEND_AFTER_SEC,
  type OtpPurpose,
  type Session,
} from '../../auth.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';

/**
 * Auth scenarios (T-085): OTP, sessions, refresh, logout, CSRF, PIN and lockout, run against both
 * mock backends. Each scenario has its own mobile number (the backends keep state across
 * scenarios) and its own client, so its own cookies. Time moves only through `advanceTime`.
 */

const expectError = async (
  pending: ReturnType<ScenarioClient['callError']>,
  status: number,
  code: string,
  details?: AuthErrorDetails,
) => {
  const { status: actual, body } = await pending;
  expect(actual).toBe(status);
  expect(body.error.code).toBe(code);
  if (details !== undefined) expect(AuthErrorDetails.parse(body.error.details)).toEqual(details);
};

const PIN = '482105';
const WRONG_PIN = '000000';

async function requestOtp(client: ScenarioClient, mobile: string, purpose: OtpPurpose = 'LOGIN') {
  const { requestId } = await client.call('otpRequest', { body: { mobile, purpose } });
  return requestId;
}

async function login(client: ScenarioClient, mobile: string): Promise<Session> {
  const requestId = await requestOtp(client, mobile);
  return client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
}

/** Logs in and sets the PIN, which trusts this client's device. */
async function trustDevice(client: ScenarioClient, mobile: string): Promise<Session> {
  const session = await login(client, mobile);
  const { device } = await client.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
  expect(device).toMatchObject({ id: session.device.id, trusted: true });
  return session;
}

export const authScenarios = defineScenarios('auth', [
  // ---- OTP --------------------------------------------------------------------------------
  {
    name: 'otp: the dev OTP logs a new user in and the session reads back',
    async run(client) {
      const session = await login(client, '8100000001');

      expect(session.user).toMatchObject({ mobileMasked: '******0001', pinSet: false });
      expect(session.device).toMatchObject({ trusted: false, current: true });
      expect(client.csrfToken()).toBe(session.csrfToken);

      const current = await client.call('sessionGet');
      expect(current.user.id).toBe(session.user.id);
      expect(current.device.id).toBe(session.device.id);
      expect(current.csrfToken).toBe(session.csrfToken);
    },
  },
  {
    name: 'otp: a resend within 30 s is 429 with the seconds left, and allowed after',
    async run(client) {
      const mobile = '8100000002';
      await requestOtp(client, mobile);

      const { status, body } = await client.callError('otpRequest', { body: { mobile } });
      expect(status).toBe(429);
      expect(body.error.code).toBe('RATE_LIMITED');
      const { retryAfterSec } = AuthErrorDetails.parse(body.error.details);
      expect(retryAfterSec).toBeGreaterThan(0);
      expect(retryAfterSec).toBeLessThanOrEqual(OTP_RESEND_AFTER_SEC);

      await client.advanceTime(OTP_RESEND_AFTER_SEC * 1000);
      await requestOtp(client, mobile);
    },
  },
  {
    name: 'otp: the 3rd wrong OTP sets captchaRequired; the right OTP then needs the CAPTCHA',
    async run(client) {
      const mobile = '8100000003';
      const requestId = await requestOtp(client, mobile);
      const verify = (otp: string, captchaToken?: string) =>
        client.callError('otpVerify', {
          body: { requestId, mobile, otp, ...(captchaToken ? { captchaToken } : {}) },
        });

      await expectError(verify('000000'), 400, 'OTP_INVALID', {
        attemptsLeft: 4,
        captchaRequired: false,
      });
      await expectError(verify('000000'), 400, 'OTP_INVALID', {
        attemptsLeft: 3,
        captchaRequired: false,
      });
      await expectError(verify('000000'), 400, 'OTP_INVALID', {
        attemptsLeft: 2,
        captchaRequired: true,
      });
      await expectError(verify(DEV_OTP), 400, 'CAPTCHA_REQUIRED', {
        captchaRequired: true,
        attemptsLeft: 2,
      });
      await expectError(verify(DEV_OTP, 'forged-captcha'), 400, 'CAPTCHA_REQUIRED');

      const session = await client.call('otpVerify', {
        body: { requestId, mobile, otp: DEV_OTP, captchaToken: DEV_CAPTCHA_TOKEN },
      });
      expect(session.user.mobileMasked).toBe('******0003');
    },
  },
  {
    name: 'otp: an unknown request, a used OTP or a malformed mobile is refused',
    async run(client) {
      const mobile = '8100000004';
      await expectError(
        client.callError('otpVerify', { body: { requestId: 'otp_nope', mobile, otp: DEV_OTP } }),
        400,
        'OTP_EXPIRED',
      );
      const requestId = await requestOtp(client, mobile);
      await client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
      await expectError(
        client.callError('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } }),
        400,
        'OTP_EXPIRED',
      );
      await expectError(
        client.callError('otpRequest', { body: { mobile: '12345' } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },

  // ---- CSRF -------------------------------------------------------------------------------
  {
    name: 'csrf: a POST without the header is 403; with a session it must be the session token',
    async run(client) {
      await expectError(
        client.callError('otpRequest', { body: { mobile: '8100000005' }, csrf: false }),
        403,
        'FORBIDDEN',
      );
      await login(client, '8100000005');

      await expectError(client.callError('logout', { csrf: false }), 403, 'FORBIDDEN');
      await expectError(client.callError('logout', { csrf: 'not-the-token' }), 403, 'FORBIDDEN');
      await client.call('sessionGet');
    },
  },

  // ---- Sessions ---------------------------------------------------------------------------
  {
    name: 'session: without a session, reading it or logging out is 401',
    async run(client) {
      await expectError(client.callError('sessionGet'), 401, 'UNAUTHORIZED');
      await expectError(client.callError('logout'), 401, 'UNAUTHORIZED');
      await expectError(client.callError('sessionRefresh'), 401, 'UNAUTHORIZED');
    },
  },
  {
    name: 'refresh: rotates the session and issues a new access token',
    async run(client) {
      const session = await login(client, '8100000006');

      const refreshed = await client.call('sessionRefresh');

      expect(refreshed.user.id).toBe(session.user.id);
      expect(refreshed.accessToken).not.toBe(session.accessToken);
      const current = await client.call('sessionGet');
      expect(current.accessToken).toBe(refreshed.accessToken);
    },
  },
  {
    name: 'refresh: the access token expires after 15 minutes and a refresh brings it back',
    async run(client) {
      await login(client, '8100000007');

      await client.advanceTime(ACCESS_TOKEN_TTL_SEC * 1000);
      await expectError(client.callError('sessionGet'), 401, 'UNAUTHORIZED');

      await client.call('sessionRefresh');
      await client.call('sessionGet');
    },
  },
  {
    name: 'refresh: reusing an old refresh token is 401 and ends the whole session',
    async run(client) {
      await login(client, '8100000008');
      const beforeRotation = client.cookies.snapshot();
      await client.call('sessionRefresh');
      const afterRotation = client.cookies.snapshot();

      client.cookies.restore(beforeRotation);
      await expectError(client.callError('sessionRefresh'), 401, 'UNAUTHORIZED');

      // The rightful newest cookies are dead too: the token family is revoked.
      client.cookies.restore(afterRotation);
      await expectError(client.callError('sessionGet'), 401, 'UNAUTHORIZED');
      await expectError(client.callError('sessionRefresh'), 401, 'UNAUTHORIZED');
    },
  },
  {
    name: 'logout: ends the session; neither the session nor a refresh works afterwards',
    async run(client) {
      await login(client, '8100000009');

      expect(await client.call('logout')).toEqual({ ok: true });

      await expectError(client.callError('sessionGet'), 401, 'UNAUTHORIZED');
      await expectError(client.callError('sessionRefresh'), 401, 'UNAUTHORIZED');
    },
  },

  // ---- PIN --------------------------------------------------------------------------------
  {
    name: 'pin: setting it needs a session; then the PIN logs in on the trusted device',
    async run(client) {
      await expectError(
        client.callError('pinSet', { body: { pin: PIN, confirmPin: PIN } }),
        401,
        'UNAUTHORIZED',
      );
      const first = await trustDevice(client, '8100000010');
      await client.call('logout');

      const session = await client.call('pinVerify', { body: { pin: PIN } });

      expect(session.user).toMatchObject({ id: first.user.id, pinSet: true });
      expect(session.device).toMatchObject({ id: first.device.id, trusted: true });
      await client.call('sessionGet');
    },
  },
  {
    name: 'pin: a device that was never trusted cannot use the PIN',
    async run(client) {
      await expectError(client.callError('pinVerify', { body: { pin: PIN } }), 401, 'UNAUTHORIZED');
      await login(client, '8100000011');
      await expectError(client.callError('pinVerify', { body: { pin: PIN } }), 401, 'UNAUTHORIZED');
    },
  },
  {
    name: 'lockout: the 5th wrong PIN locks the account and a verified OTP unlocks it',
    async run(client) {
      const mobile = '8100000012';
      await trustDevice(client, mobile);
      await client.call('logout');

      for (const attemptsLeft of [4, 3, 2, 1]) {
        await expectError(
          client.callError('pinVerify', { body: { pin: WRONG_PIN } }),
          400,
          'PIN_INVALID',
          { attemptsLeft },
        );
      }
      const locked = { attemptsLeft: 0, unlockWith: 'OTP' } as const;
      await expectError(
        client.callError('pinVerify', { body: { pin: WRONG_PIN } }),
        423,
        'PIN_LOCKED',
        locked,
      );
      await expectError(
        client.callError('pinVerify', { body: { pin: PIN } }),
        423,
        'PIN_LOCKED',
        locked,
      );

      await client.advanceTime(OTP_RESEND_AFTER_SEC * 1000);
      const requestId = await requestOtp(client, mobile, 'UNLOCK_PIN');
      const unlocked = await client.call('otpVerify', {
        body: { requestId, mobile, otp: DEV_OTP },
      });
      expect(unlocked.device.trusted).toBe(true);
      await client.call('logout');

      await client.call('pinVerify', { body: { pin: PIN } });
    },
  },
]);
