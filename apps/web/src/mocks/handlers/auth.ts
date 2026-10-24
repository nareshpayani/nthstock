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
  RecoveryCode,
  STEP_UP_WINDOW_SEC,
  TOTP_CHALLENGE_TTL_SEC,
  TOTP_ENROL_TTL_SEC,
  TOTP_ISSUER,
  TOTP_MAX_FAILURES,
  TOTP_RECOVERY_CODE_COUNT,
  TRUSTED_DEVICE_TTL_SEC,
  type AuthErrorDetails,
  type Device,
  type KycStatus,
  type RouteName,
  type Session,
  type User,
} from '@nthstock/contracts';
import { base32Decode, base32Encode, newTotpSecret, otpauthUri, verifyTotp } from '@nthstock/utils';
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
 *
 * Step-up and two-factor (NSTOCK-0217) follow apps/api too, on the same RFC 6238 code from
 * packages/utils, so a real authenticator app works against the mock: scan the QR code on
 * /settings/security, and the app's codes log you in. Recovery codes are kept as SHA-256 hashes
 * (apps/api uses Argon2id); the dev OTP also confirms a step-up.
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
  /** Missing in state saved before two-factor existed: read as off. */
  totpEnabled?: boolean;
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
  steppedUpAt?: number | null;
};

type OtpChallenge = {
  requestId: string;
  failures: number;
  expiresAt: number;
  purpose?: 'LOGIN' | 'UNLOCK_PIN' | 'STEP_UP';
};
type TotpFactor = {
  /** Base32, as the setup key shows it. */
  secret: string;
  status: 'PENDING' | 'ACTIVE';
  lastUsedStep: number;
  createdAt: number;
};
type TotpChallenge = {
  userId: string;
  method: 'OTP' | 'PIN';
  deviceId: string | null;
  failures: number;
  expiresAt: number;
};
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
  const totpFactors = new Map<string, TotpFactor>();
  /** SHA-256 hashes of each user's unused recovery codes. */
  const recoveryCodes = new Map<string, string[]>();
  const totpChallenges = new Map<string, TotpChallenge>();
  const tables = {
    users,
    otps,
    lastOtpAt,
    devices,
    deviceTokens,
    pins,
    sessions,
    totpFactors,
    recoveryCodes,
    totpChallenges,
  };
  /** The signed-in user per host (see `activeUserId`); not persisted, the next request sets it. */
  const activeUsers = new Map<string, string>();

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
    totpEnabled: u.totpEnabled ?? false,
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
    activeUsers.set(new URL(request.url).host, session.userId);
    return session;
  }

  // ---- OTP, PIN and two-factor checks shared by login and step-up ---------------------------

  /** Issues an OTP challenge for the mobile, with the 30 s resend throttle. */
  function requestOtp(mobile: string, purpose: NonNullable<OtpChallenge['purpose']>) {
    const at = now();
    const last = lastOtpAt.get(mobile);
    if (last !== undefined && at < last + OTP_RESEND_AFTER_SEC * 1000) {
      const retryAfterSec = Math.ceil((last + OTP_RESEND_AFTER_SEC * 1000 - at) / 1000);
      throw fail(
        429,
        'RATE_LIMITED',
        `Please wait ${String(retryAfterSec)} seconds before requesting another OTP.`,
        { retryAfterSec },
      );
    }
    lastOtpAt.set(mobile, at);
    const challenge = {
      requestId: randomId('otp'),
      failures: 0,
      expiresAt: at + OTP_TTL_SEC * 1000,
      purpose,
    };
    otps.set(mobile, challenge);
    return {
      requestId: challenge.requestId,
      resendAfterSec: OTP_RESEND_AFTER_SEC,
      expiresAt: iso(challenge.expiresAt),
    };
  }

  /** Checks and consumes an OTP; resolves to its purpose. */
  function checkOtp(body: {
    mobile: string;
    requestId: string;
    otp: string;
    captchaToken?: string | undefined;
  }) {
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
    return challenge.purpose ?? 'LOGIN';
  }

  /** Compares the PIN with the 5-strike lock. */
  async function checkPin(pin: PinRecord, value: string) {
    if (pin.failures >= PIN_MAX_FAILURES) throw pinLocked();
    if ((await sha256(`${pin.salt}:${value}`)) !== pin.hash) {
      pin.failures += 1;
      if (pin.failures >= PIN_MAX_FAILURES) throw pinLocked();
      throw fail(400, 'PIN_INVALID', 'Incorrect PIN. Please try again.', {
        attemptsLeft: PIN_MAX_FAILURES - pin.failures,
      });
    }
    pin.failures = 0;
  }

  const totpInvalid = (attemptsLeft?: number) =>
    fail(
      400,
      'TOTP_INVALID',
      attemptsLeft === 0
        ? 'Too many wrong codes. Log in again.'
        : 'That code is not right. Check your authenticator app and try again.',
      attemptsLeft === undefined ? undefined : { attemptsLeft },
    );
  const conflict = (message: string) => fail(409, 'CONFLICT', message);

  /** A current code for the user's active factor, accepted once (a replayed step fails). */
  async function codeIsRight(userId: string, code: string) {
    const factor = totpFactors.get(userId);
    if (factor?.status !== 'ACTIVE') return false;
    const step = await verifyTotp(base32Decode(factor.secret), code, now(), {
      afterStep: factor.lastUsedStep,
    });
    if (step === null) return false;
    factor.lastUsedStep = step;
    return true;
  }

  async function recoveryCodeIsRight(userId: string, typed: string) {
    const parsed = RecoveryCode.safeParse(typed);
    if (!parsed.success) return false;
    const hash = await sha256(parsed.data);
    const codes = recoveryCodes.get(userId) ?? [];
    const index = codes.indexOf(hash);
    if (index < 0) return false;
    codes.splice(index, 1);
    return true;
  }

  const secondFactorIsRight = (
    userId: string,
    proof: { code?: string | undefined; recoveryCode?: string | undefined },
  ) =>
    proof.code !== undefined
      ? codeIsRight(userId, proof.code)
      : proof.recoveryCode !== undefined
        ? recoveryCodeIsRight(userId, proof.recoveryCode)
        : Promise.resolve(false);

  /** Ten new recovery codes: stores their hashes, resolves to them in display form. */
  async function newRecoveryCodes(userId: string) {
    const codes = Array.from({ length: TOTP_RECOVERY_CODE_COUNT }, () =>
      base32Encode(crypto.getRandomValues(new Uint8Array(10))),
    );
    recoveryCodes.set(userId, await Promise.all(codes.map((code) => sha256(code))));
    return codes.map((code) => code.replace(/(.{4})(?=.)/g, '$1-'));
  }

  function requireStepUp(session: SessionRecord, user: UserRecord) {
    const at = session.steppedUpAt;
    if (at && now() - at < STEP_UP_WINDOW_SEC * 1000) return;
    throw fail(403, 'STEP_UP_REQUIRED', 'Confirm it is you to continue.', {
      totpRequired: user.totpEnabled ?? false,
    });
  }

  /** The login gate after a right PIN or OTP: 401 TOTP_REQUIRED for a user with two-factor on. */
  function requireCodeIfEnabled(user: UserRecord, method: 'OTP' | 'PIN', deviceId: string | null) {
    if (!user.totpEnabled) return;
    const challengeId = randomId('tc');
    totpChallenges.set(challengeId, {
      userId: user.id,
      method,
      deviceId,
      failures: 0,
      expiresAt: now() + TOTP_CHALLENGE_TTL_SEC * 1000,
    });
    throw fail(401, 'TOTP_REQUIRED', 'Enter the code from your authenticator app.', {
      challengeId,
    });
  }

  /** The signed-in user and session for a two-factor route. */
  function signedIn(context: Pick<ResolverContext<'health'>, 'request' | 'cookies'>) {
    const session = authenticate(context);
    const user = userById(session.userId);
    if (!user) throw unauthorized();
    return { session, user };
  }

  const route = <N extends RouteName>(
    name: N,
    resolver: RouteResolver<N>,
    options: RouteHandlerOptions,
  ) => defineRoute(name, persisted(resolver), options);

  const handlers = (options: RouteHandlerOptions = {}): HttpHandler[] => [
    route('otpRequest', ({ body }) => requestOtp(body.mobile, body.purpose), options),

    route(
      'otpVerify',
      ({ body, cookies, headers }) => {
        // A step-up OTP only ever confirms a signed-in user; it never logs anyone in.
        if (checkOtp(body) === 'STEP_UP') throw otpExpired();

        let user = users.get(body.mobile);
        if (!user) {
          user = {
            id: randomId('usr'),
            mobile: body.mobile,
            name: null,
            email: null,
            kycStatus: 'NOT_STARTED',
            pinSet: false,
            totpEnabled: false,
            createdAt: now(),
          };
          users.set(user.mobile, user);
        }
        const trusted = trustedDevice(cookies);
        const deviceId = trusted?.userId === user.id ? trusted.id : null;
        requireCodeIfEnabled(user, 'OTP', deviceId);
        const pin = pins.get(user.id);
        if (pin) pin.failures = 0; // a verified OTP lifts the PIN lock
        return startSession(user, deviceId, headers);
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
        await checkPin(pin, body.pin);
        requireCodeIfEnabled(user, 'PIN', device.id);
        return startSession(user, device.id, headers);
      },
      options,
    ),

    // ---- Step-up and two-factor (NSTOCK-0217) ------------------------------------------------

    route(
      'totpVerify',
      async ({ body, headers }) => {
        const challenge = totpChallenges.get(body.challengeId);
        const user = challenge ? userById(challenge.userId) : null;
        if (!challenge || !user || challenge.expiresAt <= now()) {
          totpChallenges.delete(body.challengeId);
          throw fail(401, 'UNAUTHORIZED', 'This sign-in has expired. Log in again.');
        }
        if (!(await secondFactorIsRight(user.id, body))) {
          challenge.failures += 1;
          const attemptsLeft = Math.max(0, TOTP_MAX_FAILURES - challenge.failures);
          if (attemptsLeft === 0) totpChallenges.delete(body.challengeId);
          throw totpInvalid(attemptsLeft);
        }
        totpChallenges.delete(body.challengeId);
        if (challenge.method === 'OTP') {
          const pin = pins.get(user.id);
          if (pin) pin.failures = 0;
        }
        return startSession(user, challenge.deviceId, headers);
      },
      options,
    ),

    route(
      'stepUpOtpRequest',
      (context) => requestOtp(signedIn(context).user.mobile, 'STEP_UP'),
      options,
    ),

    route(
      'stepUp',
      async (context) => {
        const { session, user } = signedIn(context);
        const { body } = context;
        if (body.pin !== undefined) {
          const pin = pins.get(user.id);
          if (!pin) throw fail(400, 'PIN_INVALID', 'Set a PIN first, or confirm with an OTP.');
          await checkPin(pin, body.pin);
        } else {
          const purpose = checkOtp({
            mobile: user.mobile,
            requestId: body.requestId ?? '',
            otp: body.otp ?? '',
          });
          if (purpose !== 'STEP_UP') throw otpExpired();
        }
        if (user.totpEnabled) {
          const right = body.totpCode ? await codeIsRight(user.id, body.totpCode) : false;
          if (!right) {
            throw fail(
              400,
              'TOTP_INVALID',
              body.totpCode
                ? 'That code is not right. Check your authenticator app and try again.'
                : 'Enter the code from your authenticator app.',
              { totpRequired: true },
            );
          }
        }
        session.steppedUpAt = now();
        return { steppedUpUntil: iso(session.steppedUpAt + STEP_UP_WINDOW_SEC * 1000) };
      },
      options,
    ),

    route(
      'totpEnrol',
      (context) => {
        const { session, user } = signedIn(context);
        requireStepUp(session, user);
        if (totpFactors.get(user.id)?.status === 'ACTIVE') {
          throw conflict('Two-factor authentication is already on.');
        }
        const secret = newTotpSecret();
        const at = now();
        totpFactors.set(user.id, {
          secret: base32Encode(secret),
          status: 'PENDING',
          lastUsedStep: 0,
          createdAt: at,
        });
        return {
          setupKey: base32Encode(secret),
          otpauthUri: otpauthUri({ issuer: TOTP_ISSUER, label: mask(user.mobile), secret }),
          expiresAt: iso(at + TOTP_ENROL_TTL_SEC * 1000),
        };
      },
      options,
    ),

    route(
      'totpEnrolConfirm',
      async (context) => {
        const { session, user } = signedIn(context);
        requireStepUp(session, user);
        const factor = totpFactors.get(user.id);
        if (factor?.status === 'ACTIVE') throw conflict('Two-factor authentication is already on.');
        if (!factor || now() - factor.createdAt > TOTP_ENROL_TTL_SEC * 1000) {
          throw conflict('This setup has expired. Start again.');
        }
        const step = await verifyTotp(base32Decode(factor.secret), context.body.code, now());
        if (step === null) throw totpInvalid();
        factor.status = 'ACTIVE';
        factor.lastUsedStep = step;
        user.totpEnabled = true;
        return { codes: await newRecoveryCodes(user.id) };
      },
      options,
    ),

    route(
      'totpDisable',
      async (context) => {
        const { session, user } = signedIn(context);
        requireStepUp(session, user);
        if (totpFactors.get(user.id)?.status !== 'ACTIVE') {
          throw conflict('Two-factor authentication is not turned on.');
        }
        if (!(await secondFactorIsRight(user.id, context.body))) throw totpInvalid();
        totpFactors.delete(user.id);
        recoveryCodes.delete(user.id);
        user.totpEnabled = false;
        return { ok: true as const };
      },
      options,
    ),

    route(
      'totpRecoveryCodes',
      async (context) => {
        const { session, user } = signedIn(context);
        requireStepUp(session, user);
        if (totpFactors.get(user.id)?.status !== 'ACTIVE') {
          throw conflict('Two-factor authentication is not turned on.');
        }
        if (!(await codeIsRight(user.id, context.body.code))) throw totpInvalid();
        return { codes: await newRecoveryCodes(user.id) };
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
        activeUsers.delete(new URL(context.request.url).host);
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
    /**
     * Who is signed in at `host` (e.g. `localhost:5173`): the user of the latest authenticated
     * request there, until they log out. The mock WebSocket uses it for the private order channel,
     * since an intercepted socket carries no cookies. A browser has one session per host, so this
     * is the user whose tab opened the socket.
     */
    activeUserId: (host: string): string | null => activeUsers.get(host) ?? null,
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
