import {
  AUTH_COOKIES,
  DEV_OTP,
  OtpRequestResponse,
  PIN_MAX_FAILURES,
  routes,
} from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import {
  PRE_SESSION_CSRF,
  cookieHeader,
  csrfHeader,
  loginWithOtp,
  setCookies,
  type LoggedIn,
} from '../../test/authFlow.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import type { AuditRecord } from '../audit/schema.js';

// The auth audit entries (T-188, spec backend-core §8): each login outcome writes exactly one
// entry, and none of them carries the mobile, the OTP, the PIN or a token.

const MOBILE = '9876543210';
const UNKNOWN_MOBILE = '9123456789';
const PIN = '482105';
const WRONG_PIN = '111111';
const OTP_WAIT_MS = 30_000;

let clock: ManualClock;
let app: App;
/** Every secret or PII value the tests use; none may appear anywhere in an entry. */
let secrets: string[];

beforeEach(() => {
  clock = manualClock();
  app = buildApp({ deps: { clock } });
  secrets = [MOBILE, UNKNOWN_MOBILE, DEV_OTP, PIN, WRONG_PIN];
});

afterEach(async () => {
  const all = await app.deps.repos.audit.list();
  const text = JSON.stringify(all);
  for (const secret of secrets.filter(Boolean)) expect(text).not.toContain(secret);
  await app.close();
});

/** Runs `step` and returns the audit entries it wrote. */
async function written(step: () => Promise<unknown>): Promise<AuditRecord[]> {
  const before = (await app.deps.repos.audit.list()).length;
  await step();
  return (await app.deps.repos.audit.list()).slice(before);
}

/** Logs in with OTP; `sessionId` is the one its LOGIN_SUCCESS entry names. */
async function login(mobile = MOBILE): Promise<LoggedIn & { sessionId: string }> {
  let loggedIn: LoggedIn | undefined;
  const entries = await written(async () => {
    loggedIn = await loginWithOtp(app, mobile);
  });
  if (!loggedIn) throw new Error('no login');
  secrets.push(loggedIn.access, loggedIn.refresh, loggedIn.csrf);
  const sessionId = entries[0]?.detail['sessionId'];
  if (typeof sessionId !== 'string') throw new Error('no LOGIN_SUCCESS entry');
  return { ...loggedIn, sessionId };
}

const verifyOtp = async (mobile: string, otp: string) => {
  const requested = await app.inject({
    method: 'POST',
    url: routes.otpRequest.path,
    headers: PRE_SESSION_CSRF,
    payload: { mobile },
  });
  const { requestId } = OtpRequestResponse.parse(requested.json());
  return app.inject({
    method: 'POST',
    url: routes.otpVerify.path,
    headers: PRE_SESSION_CSRF,
    payload: { requestId, mobile, otp },
  });
};

async function trustDevice(): Promise<{ user: LoggedIn; device: string }> {
  const user = await login();
  const response = await app.inject({
    method: 'POST',
    url: routes.pinSet.path,
    headers: {
      ...csrfHeader(user.csrf),
      cookie: cookieHeader({ [AUTH_COOKIES.access]: user.access }),
    },
    payload: { pin: PIN, confirmPin: PIN },
  });
  expect(response.statusCode).toBe(200);
  const device = setCookies(response)[AUTH_COOKIES.device] ?? '';
  secrets.push(device);
  return { user, device };
}

const verifyPin = (device: string, pin: string) =>
  app.inject({
    method: 'POST',
    url: routes.pinVerify.path,
    headers: { ...PRE_SESSION_CSRF, cookie: cookieHeader({ [AUTH_COOKIES.device]: device }) },
    payload: { pin },
  });

const refresh = (token: string) =>
  app.inject({
    method: 'POST',
    url: routes.sessionRefresh.path,
    headers: { ...PRE_SESSION_CSRF, cookie: cookieHeader({ [AUTH_COOKIES.refresh]: token }) },
  });

describe('auth audit entries (T-188)', () => {
  it('writes one LOGIN_SUCCESS for an OTP login', async () => {
    let user: LoggedIn | undefined;
    const entries = await written(async () => {
      user = await loginWithOtp(app, MOBILE);
    });

    const { session } = user as LoggedIn;
    expect(entries).toEqual([
      expect.objectContaining({
        actor: { type: 'user', userId: session.user.id },
        userId: session.user.id,
        action: 'LOGIN_SUCCESS',
        outcome: 'OK',
        detail: {
          method: 'OTP',
          sessionId: expect.stringMatching(/^ses_/) as string,
          deviceId: session.device.id,
        },
      }),
    ]);
  });

  it('writes one LOGIN_FAILED for a wrong OTP, with no user for an unknown mobile', async () => {
    const unknown = await written(async () => {
      expect((await verifyOtp(UNKNOWN_MOBILE, '000000')).statusCode).toBe(400);
    });
    const user = await login();
    clock.advance(OTP_WAIT_MS);
    const known = await written(async () => {
      expect((await verifyOtp(MOBILE, '000000')).statusCode).toBe(400);
    });

    expect(unknown).toEqual([
      expect.objectContaining({
        actor: { type: 'system' },
        userId: null,
        action: 'LOGIN_FAILED',
        outcome: 'REFUSED',
        detail: { method: 'OTP', reason: 'OTP_INVALID' },
      }),
    ]);
    expect(known).toEqual([
      expect.objectContaining({ userId: user.session.user.id, action: 'LOGIN_FAILED' }),
    ]);
  });

  it('writes one PIN_SET, then one LOGIN_SUCCESS for a PIN login', async () => {
    let trusted: { user: LoggedIn; device: string } | undefined;
    const set = await written(async () => {
      trusted = await trustDevice();
    });
    const { user, device } = trusted as { user: LoggedIn; device: string };

    expect(set.map((entry) => entry.action)).toEqual(['LOGIN_SUCCESS', 'PIN_SET']);
    expect(set[1]).toMatchObject({
      actor: { type: 'user', userId: user.session.user.id },
      detail: { deviceId: user.session.device.id },
    });

    const pinLogin = await written(async () => {
      expect((await verifyPin(device, PIN)).statusCode).toBe(200);
    });
    expect(pinLogin).toEqual([
      expect.objectContaining({
        action: 'LOGIN_SUCCESS',
        userId: user.session.user.id,
        detail: expect.objectContaining({ method: 'PIN', deviceId: user.session.device.id }),
      }),
    ]);
  });

  it('writes one LOGIN_FAILED per wrong PIN and one PIN_LOCKED for the one that locks', async () => {
    const { user, device } = await trustDevice();
    const userId = user.session.user.id;

    for (let attempt = 1; attempt < PIN_MAX_FAILURES; attempt += 1) {
      const entries = await written(async () => {
        expect((await verifyPin(device, WRONG_PIN)).statusCode).toBe(400);
      });
      expect(entries).toEqual([
        expect.objectContaining({
          actor: { type: 'system' },
          userId,
          action: 'LOGIN_FAILED',
          outcome: 'REFUSED',
          detail: {
            method: 'PIN',
            reason: 'PIN_INVALID',
            deviceId: user.session.device.id,
            attemptsLeft: PIN_MAX_FAILURES - attempt,
          },
        }),
      ]);
    }

    const lock = await written(async () => {
      expect((await verifyPin(device, WRONG_PIN)).statusCode).toBe(423);
    });
    expect(lock).toEqual([
      expect.objectContaining({
        userId,
        action: 'PIN_LOCKED',
        outcome: 'REFUSED',
        detail: { deviceId: user.session.device.id, failures: PIN_MAX_FAILURES },
      }),
    ]);

    // Trying again while locked, even with the right PIN, is a failed login.
    const locked = await written(async () => {
      expect((await verifyPin(device, PIN)).statusCode).toBe(423);
    });
    expect(locked).toEqual([
      expect.objectContaining({
        action: 'LOGIN_FAILED',
        detail: { method: 'PIN', reason: 'PIN_LOCKED', deviceId: user.session.device.id },
      }),
    ]);
  });

  it('writes one LOGIN_FAILED for a PIN on an untrusted device', async () => {
    const entries = await written(async () => {
      expect((await verifyPin('not-a-device-token', PIN)).statusCode).toBe(401);
    });

    expect(entries).toEqual([
      expect.objectContaining({
        userId: null,
        action: 'LOGIN_FAILED',
        detail: { method: 'PIN', reason: 'UNAUTHORIZED' },
      }),
    ]);
  });

  it('writes one REFRESH_REUSE_DETECTED when a rotated refresh token comes back', async () => {
    const user = await login();
    const rotated = await written(async () => {
      const response = await refresh(user.refresh);
      expect(response.statusCode).toBe(200);
      secrets.push(...Object.values(setCookies(response)));
    });
    expect(rotated).toEqual([]);

    const reused = await written(async () => {
      expect((await refresh(user.refresh)).statusCode).toBe(401);
    });

    expect(reused).toEqual([
      expect.objectContaining({
        actor: { type: 'system' },
        userId: user.session.user.id,
        action: 'REFRESH_REUSE_DETECTED',
        outcome: 'REFUSED',
        detail: { sessionId: user.sessionId },
      }),
    ]);
  });

  it('writes one LOGOUT', async () => {
    const user = await login();

    const entries = await written(async () => {
      const response = await app.inject({
        method: 'POST',
        url: routes.logout.path,
        headers: {
          ...csrfHeader(user.csrf),
          cookie: cookieHeader({ [AUTH_COOKIES.access]: user.access }),
        },
      });
      expect(response.statusCode).toBe(200);
    });

    expect(entries).toEqual([
      expect.objectContaining({
        actor: { type: 'user', userId: user.session.user.id },
        action: 'LOGOUT',
        outcome: 'OK',
        detail: { sessionId: user.sessionId },
      }),
    ]);
  });
});
