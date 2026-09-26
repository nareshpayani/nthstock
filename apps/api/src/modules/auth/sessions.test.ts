import { ACCESS_TOKEN_TTL_SEC, AUTH_COOKIES, ApiError, Session, routes } from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { cookieHeader, loginWithOtp, setCookieLine, setCookies } from '../../test/authFlow.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import { DEMO_USER } from '../users/repo.js';

const MOBILE = '9876543210';
/** The OTP resend throttle, waited out before a second login for the same mobile. */
const OTP_WAIT_MS = 30_000;
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

let clock: ManualClock;
let app: App;

beforeEach(() => {
  clock = manualClock();
  app = buildApp({ deps: { clock } });
});

afterEach(async () => {
  await app.close();
});

const getSession = (cookies: Record<string, string>, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'GET',
    url: routes.sessionGet.path,
    headers: { cookie: cookieHeader(cookies), ...headers },
  });

const refresh = (token: string | null) =>
  app.inject({
    method: 'POST',
    url: routes.sessionRefresh.path,
    headers: token === null ? {} : { cookie: cookieHeader({ [AUTH_COOKIES.refresh]: token }) },
  });

const logout = (access: string) =>
  app.inject({
    method: 'POST',
    url: routes.logout.path,
    headers: { cookie: cookieHeader({ [AUTH_COOKIES.access]: access }) },
  });

describe('OTP login', () => {
  it('creates the user and a session with a 15-min access token', async () => {
    const {
      session,
      access,
      refresh: rt,
      response,
    } = await loginWithOtp(app, MOBILE, {
      'user-agent': CHROME_MAC,
    });

    expect(session.user).toMatchObject({ mobileMasked: '******3210', pinSet: false });
    expect(session.device).toMatchObject({
      label: 'Chrome on macOS',
      trusted: false,
      current: true,
    });
    expect(session.accessToken).toBe(access);
    expect(Date.parse(session.accessTokenExpiresAt) - clock.now().getTime()).toBe(
      ACCESS_TOKEN_TTL_SEC * 1000,
    );
    expect(rt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body).not.toContain(rt);
    expect(response.body).not.toContain(MOBILE);
  });

  it('sets httpOnly SameSite=Strict cookies, the refresh token only for /v1/auth', async () => {
    const { response } = await loginWithOtp(app, MOBILE);

    expect(setCookieLine(response, AUTH_COOKIES.access)).toMatch(
      /; Max-Age=900; Path=\/; SameSite=Strict; HttpOnly$/,
    );
    expect(setCookieLine(response, AUTH_COOKIES.refresh)).toMatch(
      /; Max-Age=2592000; Path=\/v1\/auth; SameSite=Strict; HttpOnly$/,
    );
  });

  it('marks cookies Secure in production', async () => {
    // Production draws a random OTP; a capturing SMS provider hands it to the test.
    const lines: string[] = [];
    await app.close();
    app = buildApp({
      deps: {
        clock,
        production: true,
        jwtSecret: new TextEncoder().encode('p'.repeat(32)),
        sms: {
          sendOtp: ({ otp }) => {
            lines.push(otp);
            return Promise.resolve();
          },
        },
      },
    });
    const requested = await app.inject({
      method: 'POST',
      url: routes.otpRequest.path,
      payload: { mobile: MOBILE },
    });
    const { requestId } = requested.json<{ requestId: string }>();
    const verified = await app.inject({
      method: 'POST',
      url: routes.otpVerify.path,
      payload: { requestId, mobile: MOBILE, otp: lines[0] },
    });

    expect(verified.statusCode).toBe(200);
    expect(setCookieLine(verified, AUTH_COOKIES.access)).toMatch(/; Secure$/);
    expect(setCookieLine(verified, AUTH_COOKIES.refresh)).toMatch(/; Secure$/);
  });

  it('logs an existing user in without creating another', async () => {
    const { session } = await loginWithOtp(app, DEMO_USER.mobile);
    expect(session.user.id).toBe(DEMO_USER.id);
  });
});

describe('GET /v1/auth/session', () => {
  it('returns the session for the access cookie or a Bearer token', async () => {
    const { access } = await loginWithOtp(app, MOBILE);

    const byCookie = await getSession({ [AUTH_COOKIES.access]: access });
    const byBearer = await getSession({}, { authorization: `Bearer ${access}` });

    expect(byCookie.statusCode).toBe(200);
    expect(Session.parse(byCookie.json()).accessToken).toBe(access);
    expect(byBearer.statusCode).toBe(200);
  });

  it('answers 401 without a token, with a tampered one, or after 15 minutes', async () => {
    const { access } = await loginWithOtp(app, MOBILE);

    expect((await getSession({})).statusCode).toBe(401);
    expect((await getSession({ [AUTH_COOKIES.access]: `${access}x` })).statusCode).toBe(401);
    clock.advance(ACCESS_TOKEN_TTL_SEC * 1000 - 1000);
    expect((await getSession({ [AUTH_COOKIES.access]: access })).statusCode).toBe(200);
    clock.advance(1000);
    const expired = await getSession({ [AUTH_COOKIES.access]: access });
    expect(expired.statusCode).toBe(401);
    expect(ApiError.parse(expired.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('refuses a token signed with another key', async () => {
    const { access } = await loginWithOtp(app, MOBILE);
    await app.close();
    app = buildApp({ deps: { clock } });

    expect((await getSession({ [AUTH_COOKIES.access]: access })).statusCode).toBe(401);
  });
});

describe('POST /v1/auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const first = await loginWithOtp(app, MOBILE);
    clock.advance(60_000);

    const response = await refresh(first.refresh);

    expect(response.statusCode).toBe(200);
    const cookies = setCookies(response);
    const next = cookies[AUTH_COOKIES.refresh] ?? '';
    expect(next).not.toBe(first.refresh);
    expect(next).not.toBe('');
    const session = Session.parse(response.json());
    expect(session.accessToken).toBe(cookies[AUTH_COOKIES.access]);
    expect(session.accessToken).not.toBe(first.access);
    expect(session.user.id).toBe(first.session.user.id);
    expect((await getSession({ [AUTH_COOKIES.access]: session.accessToken })).statusCode).toBe(200);
  });

  it('reusing a refresh token returns 401 and revokes the token family', async () => {
    const first = await loginWithOtp(app, MOBILE);
    const rotated = await refresh(first.refresh);
    const second = setCookies(rotated);

    const reused = await refresh(first.refresh);

    expect(reused.statusCode).toBe(401);
    expect(ApiError.parse(reused.json()).error.code).toBe('UNAUTHORIZED');
    expect(setCookies(reused)).toEqual({ [AUTH_COOKIES.access]: '', [AUTH_COOKIES.refresh]: '' });
    // The whole family is gone: the newer refresh token and every access token of the session.
    expect((await refresh(second[AUTH_COOKIES.refresh] ?? '')).statusCode).toBe(401);
    expect(
      (await getSession({ [AUTH_COOKIES.access]: second[AUTH_COOKIES.access] ?? '' })).statusCode,
    ).toBe(401);
    expect((await getSession({ [AUTH_COOKIES.access]: first.access })).statusCode).toBe(401);
  });

  it('leaves other sessions of the same user alone', async () => {
    const stolen = await loginWithOtp(app, MOBILE);
    clock.advance(OTP_WAIT_MS);
    const other = await loginWithOtp(app, MOBILE);
    await refresh(stolen.refresh);
    await refresh(stolen.refresh);

    expect((await getSession({ [AUTH_COOKIES.access]: other.access })).statusCode).toBe(200);
  });

  it('answers 401 without a cookie or with an unknown or expired token', async () => {
    expect((await refresh(null)).statusCode).toBe(401);
    expect((await refresh('not-a-real-token')).statusCode).toBe(401);

    const { refresh: token } = await loginWithOtp(app, MOBILE);
    clock.advance(30 * 24 * 3600 * 1000);
    expect((await refresh(token)).statusCode).toBe(401);
  });
});

describe('POST /v1/auth/logout', () => {
  it('revokes the session and clears both cookies', async () => {
    const { access, refresh: rt } = await loginWithOtp(app, MOBILE);

    const response = await logout(access);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(setCookieLine(response, AUTH_COOKIES.access)).toMatch(/^nth_at=; Max-Age=0; Path=\//);
    expect(setCookieLine(response, AUTH_COOKIES.refresh)).toMatch(
      /^nth_rt=; Max-Age=0; Path=\/v1\/auth/,
    );
    expect((await getSession({ [AUTH_COOKIES.access]: access })).statusCode).toBe(401);
    expect((await refresh(rt)).statusCode).toBe(401);
  });

  it('answers 401 without a session', async () => {
    expect((await logout('nope')).statusCode).toBe(401);
  });
});
