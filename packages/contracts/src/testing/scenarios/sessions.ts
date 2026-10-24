import { expect } from 'vitest';
import { CONSENT_POLICY_VERSION, DEV_OTP, type Session } from '../../auth.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';
import type { CookieSnapshot } from '../cookieJar.js';

/**
 * Active sessions scenarios (NSTOCK-0225), run against both mock backends. One client is one tab,
 * so a second device is the same client with its cookies put back to blank before logging in; the
 * first device's cookies are kept to check that a revoked session really ends.
 */

const T0 = '2026-11-03T04:00:00.000Z';
const PIN = '4821';

type Device = { cookies: CookieSnapshot; session: Session };

const BLANK: CookieSnapshot = {};

/** Logs `mobile` in from a fresh browser (no cookies), after the OTP resend throttle. */
async function loginOnNewDevice(client: ScenarioClient, mobile: string): Promise<Device> {
  client.cookies.restore(BLANK);
  await client.advanceTime(31_000);
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  const session = await client.call('otpVerify', {
    body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
  });
  return { cookies: client.cookies.snapshot(), session };
}

/** Switches the client back to an earlier device's cookies. */
function useDevice(client: ScenarioClient, device: Device) {
  client.cookies.restore(device.cookies);
}

async function stepUp(client: ScenarioClient) {
  await client.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
  await client.call('stepUp', { body: { pin: PIN } });
}

export const sessionScenarios = defineScenarios('active sessions', [
  {
    name: 'sessions: lists every live session, most recently active first, the current marked',
    async run(client) {
      await client.setTime(T0);
      const mobile = '8300000001';
      const laptop = await loginOnNewDevice(client, mobile);
      const phone = await loginOnNewDevice(client, mobile);

      const { sessions } = await client.call('sessionsList');
      expect(sessions).toHaveLength(2);
      const [first, second] = sessions;
      expect(first).toMatchObject({ current: true, trusted: false });
      expect(second).toMatchObject({ current: false });
      expect(first?.deviceLabel).toEqual(phone.session.device.label);
      expect(second?.deviceLabel).toEqual(laptop.session.device.label);
      expect(Date.parse(second?.createdAt ?? '')).toBeLessThan(Date.parse(first?.createdAt ?? ''));
      // Another user's sessions never show.
      await loginOnNewDevice(client, '8300000099');
      expect((await client.call('sessionsList')).sessions).toHaveLength(1);
    },
  },
  {
    name: 'sessions: revoking another needs a step-up, then that session ends at once',
    async run(client) {
      await client.setTime(T0);
      const mobile = '8300000002';
      const laptop = await loginOnNewDevice(client, mobile);
      await loginOnNewDevice(client, mobile);
      const { sessions } = await client.call('sessionsList');
      const other = sessions.find((s) => !s.current);
      const current = sessions.find((s) => s.current);
      if (!other || !current) throw new Error('expected two sessions');

      const before = await client.callError('sessionRevoke', { params: { id: other.id } });
      expect(before.status).toBe(403);
      expect(before.body.error.code).toBe('STEP_UP_REQUIRED');

      await stepUp(client);
      const self = await client.callError('sessionRevoke', { params: { id: current.id } });
      expect(self.status).toBe(400);
      expect(self.body.error.code).toBe('VALIDATION_ERROR');
      const unknown = await client.callError('sessionRevoke', { params: { id: 'ses_missing' } });
      expect(unknown.status).toBe(404);

      await client.call('sessionRevoke', { params: { id: other.id } });
      const after = await client.call('sessionsList');
      expect(after.sessions.map((s) => s.id)).toEqual([current.id]);
      // Revoking it twice: it has already ended.
      expect((await client.callError('sessionRevoke', { params: { id: other.id } })).status).toBe(
        404,
      );

      // The laptop is logged out: its access token and its refresh token both answer 401.
      useDevice(client, laptop);
      expect((await client.callError('sessionGet')).status).toBe(401);
      expect((await client.callError('sessionRefresh')).status).toBe(401);
    },
  },
  {
    name: 'sessions: log out all other devices leaves only this one',
    async run(client) {
      await client.setTime(T0);
      const mobile = '8300000003';
      const first = await loginOnNewDevice(client, mobile);
      await loginOnNewDevice(client, mobile);
      const current = await loginOnNewDevice(client, mobile);

      expect((await client.callError('sessionsRevokeOthers')).body.error.code).toBe(
        'STEP_UP_REQUIRED',
      );
      await stepUp(client);
      expect(await client.call('sessionsRevokeOthers')).toEqual({ revoked: 2 });
      const { sessions } = await client.call('sessionsList');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.current).toBe(true);
      expect(await client.call('sessionsRevokeOthers')).toEqual({ revoked: 0 });

      useDevice(client, first);
      expect((await client.callError('sessionGet')).status).toBe(401);
      // This device carries on.
      useDevice(client, current);
      expect((await client.call('sessionGet')).user.mobileMasked).toMatch(/0003$/);
    },
  },
]);
