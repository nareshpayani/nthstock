import {
  AUTH_COOKIES,
  ApiError,
  AuthErrorDetails,
  DEV_OTP,
  OtpRequestResponse,
  PinSetResponse,
  Session,
  routes,
} from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import {
  PRE_SESSION_CSRF,
  cookieHeader,
  csrfHeader,
  loginWithOtp,
  setCookieLine,
  setCookies,
} from '../../test/authFlow.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';

const MOBILE = '9876543210';
const PIN = '482105';
const OTP_WAIT_MS = 30_000;

let clock: ManualClock;
let app: App;

beforeEach(() => {
  clock = manualClock();
  app = buildApp({ deps: { clock } });
});

afterEach(async () => {
  await app.close();
});

type Auth = { access: string; csrf: string };

const setPin = ({ access, csrf }: Auth, pin = PIN, confirmPin = pin) =>
  app.inject({
    method: 'POST',
    url: routes.pinSet.path,
    headers: { ...csrfHeader(csrf), cookie: cookieHeader({ [AUTH_COOKIES.access]: access }) },
    payload: { pin, confirmPin },
  });

const verifyPin = (deviceToken: string | null, pin: string) =>
  app.inject({
    method: 'POST',
    url: routes.pinVerify.path,
    headers:
      deviceToken === null
        ? PRE_SESSION_CSRF
        : { ...PRE_SESSION_CSRF, cookie: cookieHeader({ [AUTH_COOKIES.device]: deviceToken }) },
    payload: { pin },
  });

/** Logs in with OTP and sets the PIN; returns the trusted-device token. */
async function trustThisDevice(): Promise<{ device: string; session: Session }> {
  const login = await loginWithOtp(app, MOBILE);
  const { session } = login;
  const response = await setPin(login);
  expect(response.statusCode).toBe(200);
  return { device: setCookies(response)[AUTH_COOKIES.device] ?? '', session };
}

const errorOf = (response: { json(): unknown }) => ApiError.parse(response.json()).error;

describe('POST /v1/auth/pin/set', () => {
  it('needs a session', async () => {
    expect((await setPin({ access: 'nope', csrf: 'x' })).statusCode).toBe(401);
  });

  it('stores an Argon2id hash, trusts the device and sets the trusted-device cookie', async () => {
    const login = await loginWithOtp(app, MOBILE);
    const { session } = login;

    const response = await setPin(login);

    const { device } = PinSetResponse.parse(response.json());
    expect(device).toMatchObject({ id: session.device.id, trusted: true, current: true });
    expect(setCookieLine(response, AUTH_COOKIES.device)).toMatch(
      /^nth_dev=[A-Za-z0-9_-]{43}; Max-Age=15552000; Path=\/v1\/auth; SameSite=Strict; HttpOnly$/,
    );
    const stored = await app.deps.repos.auth.getPin(session.user.id);
    expect(stored?.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored?.hash).not.toContain(PIN);
    expect((await app.deps.repos.users.findById(session.user.id))?.pinSet).toBe(true);
  });

  it('rejects mismatched or malformed PINs', async () => {
    const login = await loginWithOtp(app, MOBILE);
    expect((await setPin(login, '1234', '4321')).statusCode).toBe(400);
    expect((await setPin(login, '12')).statusCode).toBe(400);
  });
});

describe('POST /v1/auth/pin/verify', () => {
  it('logs in on the trusted device with the right PIN', async () => {
    const { device, session: first } = await trustThisDevice();

    const response = await verifyPin(device, PIN);

    expect(response.statusCode).toBe(200);
    const session = Session.parse(response.json());
    expect(session.user.id).toBe(first.user.id);
    expect(session.device).toMatchObject({ id: first.device.id, trusted: true });
    expect(setCookies(response)[AUTH_COOKIES.access]).toBe(session.accessToken);
  });

  it('answers 401 without a trusted-device cookie, or with an unknown or expired one', async () => {
    const { device } = await trustThisDevice();

    expect((await verifyPin(null, PIN)).statusCode).toBe(401);
    expect((await verifyPin('forged-device-token', PIN)).statusCode).toBe(401);
    clock.advance(180 * 24 * 3600 * 1000);
    expect((await verifyPin(device, PIN)).statusCode).toBe(401);
  });

  it('locks the account on the 5th wrong PIN, even for the right PIN afterwards', async () => {
    const { device } = await trustThisDevice();

    for (const attemptsLeft of [4, 3, 2, 1]) {
      const wrong = await verifyPin(device, '000000');
      expect(wrong.statusCode).toBe(400);
      expect(errorOf(wrong)).toMatchObject({ code: 'PIN_INVALID', details: { attemptsLeft } });
    }
    const fifth = await verifyPin(device, '000000');
    expect(fifth.statusCode).toBe(423);
    expect(errorOf(fifth).code).toBe('PIN_LOCKED');
    expect(AuthErrorDetails.parse(errorOf(fifth).details)).toEqual({
      attemptsLeft: 0,
      unlockWith: 'OTP',
    });

    const right = await verifyPin(device, PIN);
    expect(right.statusCode).toBe(423);
    expect(errorOf(right).code).toBe('PIN_LOCKED');
  });

  it('a verified OTP clears the lock', async () => {
    const { device } = await trustThisDevice();
    for (let i = 0; i < 5; i += 1) await verifyPin(device, '000000');
    expect((await verifyPin(device, PIN)).statusCode).toBe(423);

    clock.advance(OTP_WAIT_MS);
    const requested = await app.inject({
      method: 'POST',
      url: routes.otpRequest.path,
      headers: PRE_SESSION_CSRF,
      payload: { mobile: MOBILE, purpose: 'UNLOCK_PIN' },
    });
    const { requestId } = OtpRequestResponse.parse(requested.json());
    const unlocked = await app.inject({
      method: 'POST',
      url: routes.otpVerify.path,
      headers: { ...PRE_SESSION_CSRF, cookie: cookieHeader({ [AUTH_COOKIES.device]: device }) },
      payload: { requestId, mobile: MOBILE, otp: DEV_OTP },
    });
    expect(unlocked.statusCode).toBe(200);
    // The same trusted device carries on; its cookie is untouched.
    expect(Session.parse(unlocked.json()).device.trusted).toBe(true);
    expect(setCookies(unlocked)[AUTH_COOKIES.device]).toBeUndefined();

    expect((await verifyPin(device, PIN)).statusCode).toBe(200);
  });

  it('a right PIN resets the count of wrong ones', async () => {
    const { device } = await trustThisDevice();
    for (let i = 0; i < 4; i += 1) await verifyPin(device, '000000');
    expect((await verifyPin(device, PIN)).statusCode).toBe(200);

    const wrong = await verifyPin(device, '000000');
    expect(errorOf(wrong).details).toEqual({ attemptsLeft: 4 });
  });

  it('logout keeps the device trusted', async () => {
    const { device } = await trustThisDevice();
    const { accessToken: access, csrfToken } = Session.parse((await verifyPin(device, PIN)).json());

    const out = await app.inject({
      method: 'POST',
      url: routes.logout.path,
      headers: {
        ...csrfHeader(csrfToken),
        cookie: cookieHeader({ [AUTH_COOKIES.access]: access }),
      },
    });

    expect(setCookieLine(out, AUTH_COOKIES.device)).toBeUndefined();
    expect((await verifyPin(device, PIN)).statusCode).toBe(200);
  });

  it("an OTP login by another user on the device does not take over the owner's device", async () => {
    const { device, session: owner } = await trustThisDevice();
    const requested = await app.inject({
      method: 'POST',
      url: routes.otpRequest.path,
      headers: PRE_SESSION_CSRF,
      payload: { mobile: '9123456789' },
    });
    const { requestId } = OtpRequestResponse.parse(requested.json());
    const other = await app.inject({
      method: 'POST',
      url: routes.otpVerify.path,
      headers: { ...PRE_SESSION_CSRF, cookie: cookieHeader({ [AUTH_COOKIES.device]: device }) },
      payload: { requestId, mobile: '9123456789', otp: DEV_OTP },
    });

    const session = Session.parse(other.json());
    expect(session.device.id).not.toBe(owner.device.id);
    expect(session.device.trusted).toBe(false);
  });
});
