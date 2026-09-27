import {
  ACCESS_TOKEN_TTL_SEC,
  AUTH_COOKIES,
  DEV_CAPTCHA_TOKEN,
  DEV_OTP,
  OTP_CAPTCHA_AFTER_FAILURES,
  OTP_MAX_FAILURES,
  OTP_RESEND_AFTER_SEC,
  OTP_TTL_SEC,
  PIN_MAX_FAILURES,
  REFRESH_TOKEN_TTL_SEC,
  TRUSTED_DEVICE_TTL_SEC,
  type AuthErrorDetails,
  type Device,
  type KycStatus,
  type RouteName,
  type Session,
  type User,
} from '@nthstock/contracts';
import type { HttpHandler } from 'msw';
import {
  MockApiError,
  csrfHeaderOf,
  defineRoute,
  type ResolverContext,
  type RouteHandlerOptions,
  type RouteResolver,
} from '../handlerKit';

/**
 * MSW auth handlers (T-084) with the same rules as apps/api (T-079 to T-082): the OTP is always
 * the dev OTP `123456` (nothing is sent or logged), a 30 s resend throttle, a CAPTCHA after 3 wrong OTPs, PIN lockout after 5 wrong PINs
 * lifted by a verified OTP, refresh-token rotation with reuse detection, and the CSRF token.
 *
 * The session is simulated with one cookie, `nth_msw_session` = `<session id>.<generation>`, because
 * MSW keeps only the first cookie of a mocked response. It plays both apps/api cookies: user routes
 * need its session live and its access window (15 min since the last issue) open; refresh rotates
 * the generation, and presenting an older generation is reuse, which revokes the session. The
 * trusted-device cookie keeps apps/api's name. State lives in memory; in the browser it is also
 * saved to localStorage (see `storage`), so a reload keeps users, PINs and trusted devices, just as
 * MSW keeps the mocked cookies.
 *
 * Dev login: any mobile starting 6 to 9, then the fixed dev OTP `123456` (`DEV_OTP`). It is not a
 * secret; apps/api uses it outside production too.
 */

/** The one cookie that stands in for apps/api's access and refresh cookies. */
export const MSW_SESSION_COOKIE = 'nth_msw_session';

/** The seeded demo user, the same as apps/api's `DEMO_USER` (a made-up number). */
export const MOCK_DEMO_USER = {
  id: 'usr_demo',
  mobile: '9000000001',
  name: 'Demo Investor',
} as const;

type UserRecord = {
  id: string;
  mobile: string;
  name: string | null;
  email: string | null;
  kycStatus: KycStatus;
  pinSet: boolean;
  createdAt: number;
};

type DeviceRecord = {
  id: string;
  userId: string;
  label: string;
  trusted: boolean;
  createdAt: number;
  lastSeenAt: number;
};

type SessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  csrfToken: string;
  generation: number;
  accessToken: string;
  accessExpiresAt: number;
  expiresAt: number;
  revoked: boolean;
};

type OtpChallenge = { requestId: string; failures: number; expiresAt: number };
type PinRecord = { salt: string; hash: string; failures: number };

export type AuthMockOptions = {
  /** Epoch ms; tests inject a clock. */
  now?: () => number;
  /** Whether cookies carry `Secure`; off by default (the dev server is plain http). */
  secureCookies?: boolean;
  /**
   * Where to keep the mock's state between page loads (the browser passes localStorage). Every
   * read and write is wrapped in try/catch: without storage the mock just starts fresh.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
};

/** localStorage key of the persisted auth mock state. */
export const AUTH_MOCK_STORAGE_KEY = 'nthstock.msw.auth';

const randomToken = (bytes = 32) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const randomId = (prefix: string) => `${prefix}_${randomToken(12)}`;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const iso = (ms: number) => new Date(ms).toISOString();
const mask = (mobile: string) => `******${mobile.slice(-4)}`;

const fail = (
  status: number,
  code: ConstructorParameters<typeof MockApiError>[1],
  message: string,
  details?: AuthErrorDetails,
) => new MockApiError(status, code, message, details);

const sessionEnded = () =>
  fail(401, 'UNAUTHORIZED', 'Your session has ended. Please log in again.');
const unauthorized = () => fail(401, 'UNAUTHORIZED', 'Log in to continue.');
const otpExpired = () => fail(400, 'OTP_EXPIRED', 'This OTP has expired. Request a new one.');
const untrusted = () =>
  fail(401, 'UNAUTHORIZED', "This device isn't set up for PIN login. Log in with OTP.");
const pinLocked = () =>
  fail(423, 'PIN_LOCKED', 'Too many wrong PINs. Unlock with an OTP to continue.', {
    attemptsLeft: 0,
    unlockWith: 'OTP',
  });

function cookieLine(name: string, value: string, maxAgeSec: number, path: string, secure: boolean) {
  const parts = [
    `${name}=${value}`,
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeSec)))}`,
    `Path=${path}`,
    'SameSite=Strict',
    'HttpOnly',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** The in-memory auth backend behind the handlers; exported for tests. */
export function createAuthMock({
  now = Date.now,
  secureCookies = false,
  storage,
}: AuthMockOptions = {}) {
  const users = new Map<string, UserRecord>();
  const otps = new Map<string, OtpChallenge>();
  const lastOtpAt = new Map<string, number>();
  const devices = new Map<string, DeviceRecord>();
  const deviceTokens = new Map<string, { deviceId: string; expiresAt: number }>();
  const pins = new Map<string, PinRecord>();
  const sessions = new Map<string, SessionRecord>();
  const tables = { users, otps, lastOtpAt, devices, deviceTokens, pins, sessions };

  users.set(MOCK_DEMO_USER.mobile, {
    ...MOCK_DEMO_USER,
    email: null,
    kycStatus: 'VERIFIED',
    pinSet: false,
    createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
  });

  // Restore what an earlier page load saved. Anything unreadable is ignored.
  try {
    const saved = storage?.getItem(AUTH_MOCK_STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [name, table] of Object.entries(tables)) {
        const entries = (parsed as Record<string, unknown>)[name];
        if (!Array.isArray(entries)) continue;
        // The mock wrote these entries itself; their shapes match the tables.
        for (const [key, value] of entries as [string, never][]) table.set(key, value);
      }
    }
  } catch {
    // Start fresh.
  }

  const save = () => {
    if (!storage) return;
    try {
      const snapshot = Object.fromEntries(
        Object.entries(tables).map(([name, table]) => [name, [...table.entries()]]),
      );
      storage.setItem(AUTH_MOCK_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage is a convenience; the in-memory state still works.
    }
  };

  /** Saves the state after every call, whether it succeeded or failed (failures count too). */
  const persisted =
    <A extends unknown[], R>(resolver: (...args: A) => R | Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await resolver(...args);
      } finally {
        save();
      }
    };

  const userById = (id: string) => [...users.values()].find((u) => u.id === id) ?? null;

  const toUser = (u: UserRecord): User => ({
    id: u.id,
    mobileMasked: mask(u.mobile),
    name: u.name,
    email: u.email,
    kycStatus: u.kycStatus,
    pinSet: u.pinSet,
    totpEnabled: false,
    createdAt: iso(u.createdAt),
  });

  const toDevice = (d: DeviceRecord): Device => ({
    id: d.id,
    label: d.label,
    trusted: d.trusted,
    current: true,
    createdAt: iso(d.createdAt),
    lastSeenAt: iso(d.lastSeenAt),
  });

  function toSession(session: SessionRecord): Session {
    const user = userById(session.userId);
    const device = devices.get(session.deviceId);
    if (!user || !device) throw sessionEnded();
    return {
      user: toUser(user),
      device: toDevice(device),
      accessToken: session.accessToken,
      accessTokenExpiresAt: iso(session.accessExpiresAt),
      csrfToken: session.csrfToken,
    };
  }

  /** Issues the next generation: a new access token and a new session cookie. */
  function issue(session: SessionRecord, headers: Headers): Session {
    const at = now();
    session.generation += 1;
    session.accessToken = `msw.${session.id}.${String(session.generation)}.${randomToken(16)}`;
    session.accessExpiresAt = at + ACCESS_TOKEN_TTL_SEC * 1000;
    headers.append(
      'set-cookie',
      cookieLine(
        MSW_SESSION_COOKIE,
        `${session.id}.${String(session.generation)}`,
        (session.expiresAt - at) / 1000,
        '/',
        secureCookies,
      ),
    );
    return toSession(session);
  }

  const clearSessionCookie = (headers: Headers) => {
    headers.append('set-cookie', cookieLine(MSW_SESSION_COOKIE, '', 0, '/', secureCookies));
  };

  function trustedDevice(cookies: Readonly<Record<string, string>>): DeviceRecord | null {
    const token = cookies[AUTH_COOKIES.device];
    const entry = token ? deviceTokens.get(token) : undefined;
    if (!entry || entry.expiresAt <= now()) return null;
    const device = devices.get(entry.deviceId);
    return device?.trusted ? device : null;
  }

  function startSession(user: UserRecord, deviceId: string | null, headers: Headers): Session {
    const at = now();
    let device = deviceId ? devices.get(deviceId) : undefined;
    if (device && device.userId === user.id) {
      device.lastSeenAt = at;
    } else {
      device = {
        id: randomId('dev'),
        userId: user.id,
        label: 'This browser',
        trusted: false,
        createdAt: at,
        lastSeenAt: at,
      };
      devices.set(device.id, device);
    }
    const session: SessionRecord = {
      id: randomId('ses'),
      userId: user.id,
      deviceId: device.id,
      csrfToken: randomToken(),
      generation: 0,
      accessToken: '',
      accessExpiresAt: 0,
      expiresAt: at + REFRESH_TOKEN_TTL_SEC * 1000,
      revoked: false,
    };
    sessions.set(session.id, session);
    return issue(session, headers);
  }

  /** The live session behind the request (Bearer token or session cookie), with the CSRF check. */
  function authenticate({
    request,
    cookies,
  }: Pick<ResolverContext<'health'>, 'request' | 'cookies'>) {
    const at = now();
    const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    let session: SessionRecord | undefined;
    if (bearer) {
      session = sessions.get(bearer.split('.')[1] ?? '');
      if (session?.accessToken !== bearer) session = undefined;
    } else {
      const [id = '', generation = ''] = (cookies[MSW_SESSION_COOKIE] ?? '').split('.');
      session = sessions.get(id);
      if (session?.generation !== Number(generation)) session = undefined;
    }
    if (!session || session.revoked || session.accessExpiresAt <= at) throw unauthorized();
    if (!bearer && request.method !== 'GET' && csrfHeaderOf(request) !== session.csrfToken) {
      throw fail(403, 'FORBIDDEN', 'Invalid CSRF token. Reload the page and try again.');
    }
    return session;
  }

  const route = <N extends RouteName>(
    name: N,
    resolver: RouteResolver<N>,
    options: RouteHandlerOptions,
  ) => defineRoute(name, persisted(resolver), options);

  const handlers = (options: RouteHandlerOptions = {}): HttpHandler[] => [
    route(
      'otpRequest',
      ({ body }) => {
        const at = now();
        const last = lastOtpAt.get(body.mobile);
        if (last !== undefined && at < last + OTP_RESEND_AFTER_SEC * 1000) {
          const retryAfterSec = Math.ceil((last + OTP_RESEND_AFTER_SEC * 1000 - at) / 1000);
          throw fail(
            429,
            'RATE_LIMITED',
            `Please wait ${String(retryAfterSec)} seconds before requesting another OTP.`,
            { retryAfterSec },
          );
        }
        lastOtpAt.set(body.mobile, at);
        const challenge = {
          requestId: randomId('otp'),
          failures: 0,
          expiresAt: at + OTP_TTL_SEC * 1000,
        };
        otps.set(body.mobile, challenge);
        return {
          requestId: challenge.requestId,
          resendAfterSec: OTP_RESEND_AFTER_SEC,
          expiresAt: iso(challenge.expiresAt),
        };
      },
      options,
    ),

    route(
      'otpVerify',
      ({ body, cookies, headers }) => {
        const challenge = otps.get(body.mobile);
        if (!challenge || challenge.requestId !== body.requestId) throw otpExpired();
        if (challenge.expiresAt <= now()) {
          otps.delete(body.mobile);
          throw otpExpired();
        }
        if (
          challenge.failures >= OTP_CAPTCHA_AFTER_FAILURES &&
          body.captchaToken !== DEV_CAPTCHA_TOKEN
        ) {
          throw fail(400, 'CAPTCHA_REQUIRED', 'Complete the CAPTCHA to continue.', {
            captchaRequired: true,
            attemptsLeft: OTP_MAX_FAILURES - challenge.failures,
          });
        }
        if (body.otp !== DEV_OTP) {
          challenge.failures += 1;
          if (challenge.failures >= OTP_MAX_FAILURES) {
            otps.delete(body.mobile);
            throw fail(400, 'OTP_INVALID', 'Too many wrong attempts. Request a new OTP.', {
              attemptsLeft: 0,
              captchaRequired: true,
            });
          }
          throw fail(400, 'OTP_INVALID', 'Incorrect OTP. Please try again.', {
            attemptsLeft: OTP_MAX_FAILURES - challenge.failures,
            captchaRequired: challenge.failures >= OTP_CAPTCHA_AFTER_FAILURES,
          });
        }
        otps.delete(body.mobile);

        let user = users.get(body.mobile);
        if (!user) {
          user = {
            id: randomId('usr'),
            mobile: body.mobile,
            name: null,
            email: null,
            kycStatus: 'NOT_STARTED',
            pinSet: false,
            createdAt: now(),
          };
          users.set(user.mobile, user);
        }
        const pin = pins.get(user.id);
        if (pin) pin.failures = 0; // a verified OTP lifts the PIN lock
        const trusted = trustedDevice(cookies);
        return startSession(user, trusted?.userId === user.id ? trusted.id : null, headers);
      },
      options,
    ),

    route(
      'pinSet',
      async (context) => {
        const session = authenticate(context);
        const user = userById(session.userId);
        const device = devices.get(session.deviceId);
        if (!user || !device) throw unauthorized();
        const salt = randomToken(16);
        pins.set(user.id, { salt, hash: await sha256(`${salt}:${context.body.pin}`), failures: 0 });
        user.pinSet = true;
        device.trusted = true;
        for (const [token, entry] of deviceTokens) {
          if (entry.deviceId === device.id) deviceTokens.delete(token);
        }
        const token = randomToken();
        deviceTokens.set(token, {
          deviceId: device.id,
          expiresAt: now() + TRUSTED_DEVICE_TTL_SEC * 1000,
        });
        context.headers.append(
          'set-cookie',
          cookieLine(AUTH_COOKIES.device, token, TRUSTED_DEVICE_TTL_SEC, '/v1/auth', secureCookies),
        );
        return { device: toDevice(device) };
      },
      options,
    ),

    route(
      'pinVerify',
      async ({ body, cookies, headers }) => {
        const device = trustedDevice(cookies);
        const user = device ? userById(device.userId) : null;
        const pin = user ? pins.get(user.id) : undefined;
        if (!device || !user || !pin) throw untrusted();
        if (pin.failures >= PIN_MAX_FAILURES) throw pinLocked();
        if ((await sha256(`${pin.salt}:${body.pin}`)) !== pin.hash) {
          pin.failures += 1;
          if (pin.failures >= PIN_MAX_FAILURES) throw pinLocked();
          throw fail(400, 'PIN_INVALID', 'Incorrect PIN. Please try again.', {
            attemptsLeft: PIN_MAX_FAILURES - pin.failures,
          });
        }
        pin.failures = 0;
        return startSession(user, device.id, headers);
      },
      options,
    ),

    route('sessionGet', (context) => toSession(authenticate(context)), options),

    route(
      'sessionRefresh',
      ({ cookies, headers }) => {
        try {
          const [id = '', generation = ''] = (cookies[MSW_SESSION_COOKIE] ?? '').split('.');
          const session = sessions.get(id);
          if (!session || session.revoked || session.expiresAt <= now()) throw sessionEnded();
          if (Number(generation) !== session.generation) {
            // An older generation is a reused refresh token: end the whole family.
            session.revoked = true;
            throw sessionEnded();
          }
          return issue(session, headers);
        } catch (error) {
          clearSessionCookie(headers);
          throw error;
        }
      },
      options,
    ),

    route(
      'logout',
      (context) => {
        authenticate(context).revoked = true;
        clearSessionCookie(context.headers);
        return { ok: true as const };
      },
      options,
    ),
  ];

  return {
    handlers,
    /**
     * The signed-in user's id for another mock's route (401 without a live session, 403 on a bad
     * CSRF token), so every user route shares the auth rules.
     */
    userIdOf: (context: Pick<ResolverContext<RouteName>, 'request' | 'cookies'>) =>
      authenticate(context).userId,
  };
}

export type AuthMock = ReturnType<typeof createAuthMock>;

/** Auth handlers over a fresh in-memory auth backend. */
export function authHandlers(
  rest: RouteHandlerOptions = {},
  options: AuthMockOptions = {},
): HttpHandler[] {
  return createAuthMock(options).handlers(rest);
}
