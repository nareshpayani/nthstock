import { expect } from 'vitest';
import {
  ACCOUNT_PURGE_AFTER_DAYS,
  AuthErrorDetails,
  CONSENT_POLICY_VERSION,
  DEV_OTP,
  type OtpVerifyRequest,
} from '../../auth.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';

/**
 * DPDP scenarios (NSTOCK-0232, spec backend-core §10), run against both mock backends: consent is
 * required to create an account, and a deleted account ends every session and cannot log in until
 * its data is erased.
 */

const T0 = '2026-11-04T04:00:00.000Z';
const PIN = '4821';
const DAY_MS = 24 * 60 * 60 * 1000;

async function verify(
  client: ScenarioClient,
  mobile: string,
  consent: boolean,
): Promise<OtpVerifyRequest> {
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  return {
    requestId,
    mobile,
    otp: DEV_OTP,
    ...(consent ? { consentVersion: CONSENT_POLICY_VERSION } : {}),
  };
}

export const dpdpScenarios = defineScenarios('DPDP consent and account deletion', [
  {
    name: 'consent: a new mobile needs it; with it the account is created; later logins need none',
    async run(client) {
      await client.setTime(T0);
      const mobile = '8450000001';
      const without = await client.callError('otpVerify', {
        body: await verify(client, mobile, false),
      });
      expect(without.status).toBe(400);
      expect(without.body.error.code).toBe('CONSENT_REQUIRED');

      await client.advanceTime(31_000);
      const session = await client.call('otpVerify', { body: await verify(client, mobile, true) });
      expect(session.user.mobileMasked).toBe('******0001');

      await client.call('logout');
      await client.advanceTime(31_000);
      // An existing user is not asked again.
      const again = await client.call('otpVerify', { body: await verify(client, mobile, false) });
      expect(again.user.id).toBe(session.user.id);
    },
  },
  {
    name: 'deletion: needs a step-up and DELETE, ends every session, and blocks the mobile',
    async run(client) {
      await client.setTime(T0);
      const mobile = '8450000002';
      await client.call('otpVerify', { body: await verify(client, mobile, true) });
      await client.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });

      const before = await client.callError('accountDelete', { body: { confirm: 'DELETE' } });
      expect(before.status).toBe(403);
      expect(before.body.error.code).toBe('STEP_UP_REQUIRED');
      await client.call('stepUp', { body: { pin: PIN } });
      const typo = await client.callError('accountDelete', { body: { confirm: 'delete' } });
      expect(typo.status).toBe(400);

      const { purgeAfter } = await client.call('accountDelete', { body: { confirm: 'DELETE' } });
      const days = (Date.parse(purgeAfter) - Date.parse(T0)) / DAY_MS;
      expect(days).toBeGreaterThanOrEqual(ACCOUNT_PURGE_AFTER_DAYS);
      expect(days).toBeLessThan(ACCOUNT_PURGE_AFTER_DAYS + 0.01);

      // Logged out everywhere, and the PIN no longer logs in on this browser.
      expect((await client.callError('sessionGet')).status).toBe(401);
      expect((await client.callError('sessionRefresh')).status).toBe(401);
      expect((await client.callError('pinVerify', { body: { pin: PIN } })).status).toBe(401);

      // An OTP login for the mobile answers ACCOUNT_DELETED with the purge date.
      await client.advanceTime(31_000);
      const login = await client.callError('otpVerify', {
        body: await verify(client, mobile, true),
      });
      expect(login.status).toBe(403);
      expect(login.body.error.code).toBe('ACCOUNT_DELETED');
      expect(AuthErrorDetails.parse(login.body.error.details).purgeAfter).toBe(purgeAfter);
    },
  },
]);
