import { base32Decode, totpCode } from '@nthstock/utils';
import { expect } from 'vitest';
import {
  AuthErrorDetails,
  CONSENT_POLICY_VERSION,
  DEV_OTP,
  STEP_UP_WINDOW_SEC,
  TOTP_MAX_FAILURES,
  TOTP_RECOVERY_CODE_COUNT,
  type Session,
} from '../../auth.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';

/**
 * Step-up and two-factor scenarios (NSTOCK-0218), run against both mock backends. Each scenario
 * sets the backend clock to the start of a TOTP step, so the codes it computes from the setup key
 * are the ones the backend expects; `advanceTime` moves both on together.
 */

const T0 = '2026-11-02T04:00:00.000Z';
const PIN = '482105';

/** The scenario's view of the backend clock (it runs on from `setTime`; codes allow ±1 step). */
type Clock = { now: number };

async function start(client: ScenarioClient): Promise<Clock> {
  await client.setTime(T0);
  return { now: Date.parse(T0) };
}

async function advance(client: ScenarioClient, clock: Clock, ms: number) {
  await client.advanceTime(ms);
  clock.now += ms;
}

async function login(client: ScenarioClient, mobile: string): Promise<Session> {
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  return client.call('otpVerify', {
    body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
  });
}

/** Logs in, sets the PIN and steps up with it. */
async function signedIn(client: ScenarioClient, mobile: string): Promise<Session> {
  const session = await login(client, mobile);
  await client.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
  await client.call('stepUp', { body: { pin: PIN } });
  return session;
}

/** Turns two-factor on; resolves to the secret and the recovery codes. */
async function enable(client: ScenarioClient, clock: Clock) {
  const { setupKey } = await client.call('totpEnrol');
  const secret = base32Decode(setupKey);
  const { codes } = await client.call('totpEnrolConfirm', {
    body: { code: await totpCode(secret, clock.now) },
  });
  return { secret, codes };
}

const details = (body: { error: { details?: unknown } }) =>
  AuthErrorDetails.parse(body.error.details ?? {});

/**
 * Logs out, waits out the OTP resend throttle (a new TOTP step too), then logs in with an OTP up
 * to the code step; resolves to the challenge id.
 */
async function challengeAfterOtp(
  client: ScenarioClient,
  clock: Clock,
  mobile: string,
): Promise<string> {
  await client.call('logout');
  await advance(client, clock, 31_000);
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  const { status, body } = await client.callError('otpVerify', {
    body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
  });
  expect(status).toBe(401);
  expect(body.error.code).toBe('TOTP_REQUIRED');
  const { challengeId } = details(body);
  if (!challengeId) throw new Error('TOTP_REQUIRED without a challengeId');
  return challengeId;
}

export const twoFactorScenarios = defineScenarios('step-up and two-factor', [
  // ---- Step-up ------------------------------------------------------------------------------
  {
    name: 'step-up: sensitive routes need it, a PIN gives 10 minutes, then it is needed again',
    async run(client) {
      const clock = await start(client);
      await login(client, '8200000001');
      await client.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });

      const before = await client.callError('totpEnrol');
      expect(before.status).toBe(403);
      expect(before.body.error.code).toBe('STEP_UP_REQUIRED');
      expect(details(before.body)).toEqual({ totpRequired: false });

      const wrong = await client.callError('stepUp', { body: { pin: '000000' } });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('PIN_INVALID');
      expect(details(wrong.body)).toEqual({ attemptsLeft: 4 });

      const { steppedUpUntil } = await client.call('stepUp', { body: { pin: PIN } });
      // The clock runs on from `setTime`, so allow the few ms the scenario took.
      const until = Date.parse(steppedUpUntil) - (clock.now + STEP_UP_WINDOW_SEC * 1000);
      expect(until).toBeGreaterThanOrEqual(0);
      expect(until).toBeLessThan(5000);
      await client.call('totpEnrol');

      await advance(client, clock, STEP_UP_WINDOW_SEC * 1000 + 1000);
      expect((await client.callError('totpEnrol')).body.error.code).toBe('STEP_UP_REQUIRED');
    },
  },
  {
    name: 'step-up: a STEP_UP OTP to the own mobile works, and never logs anyone in',
    async run(client) {
      await start(client);
      const mobile = '8200000002';
      await login(client, mobile);

      // The login OTP's resend throttle covers the step-up OTP to the same mobile.
      expect((await client.callError('stepUpOtpRequest')).status).toBe(429);
      await client.advanceTime(31_000);
      const { requestId } = await client.call('stepUpOtpRequest');
      // The public OTP route cannot be used to finish it as a login.
      const asLogin = await client.callError('otpVerify', {
        body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
      });
      expect(asLogin.status).toBe(400);
      expect(asLogin.body.error.code).toBe('OTP_EXPIRED');
      // And the public OTP request cannot ask for a step-up OTP.
      expect(
        (
          await client.callError('otpRequest', {
            body: { mobile: '8200000099', purpose: 'STEP_UP' },
          })
        ).status,
      ).toBe(400);

      await client.advanceTime(31_000);
      const next = await client.call('stepUpOtpRequest');
      await client.call('stepUp', { body: { requestId: next.requestId, otp: DEV_OTP } });
      await client.call('totpEnrol');
    },
  },

  // ---- Enrolment ------------------------------------------------------------------------------
  {
    name: 'totp: enrol, a wrong code is refused, the right one turns it on with 10 codes',
    async run(client) {
      const clock = await start(client);
      await signedIn(client, '8200000003');

      const enrol = await client.call('totpEnrol');
      expect(enrol.otpauthUri).toMatch(
        /^otpauth:\/\/totp\/nthstock:\*{6}0003\?secret=[A-Z2-7]{32}&issuer=nthstock/,
      );
      expect(enrol.otpauthUri).toContain(enrol.setupKey);
      expect(Date.parse(enrol.expiresAt)).toBeGreaterThan(clock.now);

      const wrong = await client.callError('totpEnrolConfirm', { body: { code: '000000' } });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('TOTP_INVALID');

      const secret = base32Decode(enrol.setupKey);
      const { codes } = await client.call('totpEnrolConfirm', {
        body: { code: await totpCode(secret, clock.now) },
      });
      expect(codes).toHaveLength(TOTP_RECOVERY_CODE_COUNT);
      expect(new Set(codes).size).toBe(TOTP_RECOVERY_CODE_COUNT);
      expect((await client.call('sessionGet')).user.totpEnabled).toBe(true);

      const again = await client.callError('totpEnrol');
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CONFLICT');
    },
  },

  // ---- Login ------------------------------------------------------------------------------
  {
    name: 'totp login: OTP then the code; a replayed code is refused, the next step works',
    async run(client) {
      const clock = await start(client);
      const mobile = '8200000004';
      await signedIn(client, mobile);
      const { secret } = await enable(client, clock);

      const challengeId = await challengeAfterOtp(client, clock, mobile);
      const code = await totpCode(secret, clock.now);
      const session = await client.call('totpVerify', { body: { challengeId, code } });
      expect(session.user.totpEnabled).toBe(true);
      expect(client.csrfToken()).toBe(session.csrfToken);

      // The next step: the code just used is still inside the ±1 window, but its step is spent.
      const replay = await challengeAfterOtp(client, clock, mobile);
      const replayed = await client.callError('totpVerify', {
        body: { challengeId: replay, code },
      });
      expect(replayed.status).toBe(400);
      expect(replayed.body.error.code).toBe('TOTP_INVALID');
      expect(details(replayed.body)).toEqual({ attemptsLeft: TOTP_MAX_FAILURES - 1 });
      await client.call('totpVerify', {
        body: { challengeId: replay, code: await totpCode(secret, clock.now) },
      });
    },
  },
  {
    name: 'totp login: a PIN login needs the code too; five wrong codes end the challenge',
    async run(client) {
      const clock = await start(client);
      const mobile = '8200000005';
      await signedIn(client, mobile);
      const { secret } = await enable(client, clock);
      await client.call('logout');

      const pinLogin = await client.callError('pinVerify', { body: { pin: PIN } });
      expect(pinLogin.status).toBe(401);
      expect(pinLogin.body.error.code).toBe('TOTP_REQUIRED');
      const { challengeId } = details(pinLogin.body);
      if (!challengeId) throw new Error('no challenge');

      for (let i = 1; i <= TOTP_MAX_FAILURES; i += 1) {
        const { body } = await client.callError('totpVerify', {
          body: { challengeId, code: '000000' },
        });
        expect(details(body)).toEqual({ attemptsLeft: TOTP_MAX_FAILURES - i });
      }
      await advance(client, clock, 31_000);
      const ended = await client.callError('totpVerify', {
        body: { challengeId, code: await totpCode(secret, clock.now) },
      });
      expect(ended.status).toBe(401);
      expect(ended.body.error.code).toBe('UNAUTHORIZED');
    },
  },
  {
    name: 'totp login: a recovery code works once, typed in any case',
    async run(client) {
      const clock = await start(client);
      const mobile = '8200000006';
      await signedIn(client, mobile);
      const { codes } = await enable(client, clock);
      const [first = ''] = codes;

      const challengeId = await challengeAfterOtp(client, clock, mobile);
      await client.call('totpVerify', {
        body: { challengeId, recoveryCode: first.toLowerCase() },
      });

      const second = await challengeAfterOtp(client, clock, mobile);
      const reused = await client.callError('totpVerify', {
        body: { challengeId: second, recoveryCode: first },
      });
      expect(reused.body.error.code).toBe('TOTP_INVALID');
    },
  },

  // ---- Step-up, codes and turning it off ---------------------------------------------------
  {
    name: 'totp: step-up then needs a code, codes regenerate, and a recovery code turns it off',
    async run(client) {
      const clock = await start(client);
      const mobile = '8200000007';
      await signedIn(client, mobile);
      const { secret, codes } = await enable(client, clock);

      const pinOnly = await client.callError('stepUp', { body: { pin: PIN } });
      expect(pinOnly.status).toBe(400);
      expect(pinOnly.body.error.code).toBe('TOTP_INVALID');
      expect(details(pinOnly.body)).toEqual({ totpRequired: true });
      await advance(client, clock, 31_000);
      await client.call('stepUp', {
        body: { pin: PIN, totpCode: await totpCode(secret, clock.now) },
      });

      await advance(client, clock, 31_000);
      const fresh = await client.call('totpRecoveryCodes', {
        body: { code: await totpCode(secret, clock.now) },
      });
      expect(fresh.codes).toHaveLength(TOTP_RECOVERY_CODE_COUNT);
      // The old codes are gone.
      const old = await client.callError('totpDisable', { body: { recoveryCode: codes[0] } });
      expect(old.body.error.code).toBe('TOTP_INVALID');

      await client.call('totpDisable', { body: { recoveryCode: fresh.codes[0] } });
      expect((await client.call('sessionGet')).user.totpEnabled).toBe(false);
      // Off: an OTP login gives a session straight away.
      await client.call('logout');
      expect((await login(client, mobile)).user.totpEnabled).toBe(false);
    },
  },
]);
