import { z } from 'zod';
import { Id, IsoUtc } from './primitives.js';

/** Indian mobile number: 10 digits starting 6–9, no country code. */
export const Mobile = z
  .string()
  .regex(/^[6-9]\d{9}$/, { error: 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9' });
export type Mobile = z.infer<typeof Mobile>;

export const Otp = z.string().regex(/^\d{6}$/, { error: 'Enter the 6-digit OTP' });
export type Otp = z.infer<typeof Otp>;

export const Pin = z.string().regex(/^\d{4,6}$/, { error: 'PIN must be 4 to 6 digits' });
export type Pin = z.infer<typeof Pin>;

/**
 * What an OTP is for. `STEP_UP` re-confirms a signed-in user before a sensitive action; it is
 * requested with `stepUpOtpRequest`, which sends it to the session's own mobile.
 */
export const OtpPurpose = z.enum(['LOGIN', 'UNLOCK_PIN', 'STEP_UP']);
export type OtpPurpose = z.infer<typeof OtpPurpose>;
/** The purposes the public OTP request takes (`OtpRequest`). */
export type LoginOtpPurpose = Exclude<OtpPurpose, 'STEP_UP'>;

export const OtpRequest = z.object({
  mobile: Mobile,
  // A step-up OTP goes only to the signed-in user's own mobile (`stepUpOtpRequest`).
  purpose: OtpPurpose.exclude(['STEP_UP']).default('LOGIN'),
});
export type OtpRequest = z.infer<typeof OtpRequest>;

export const OtpRequestResponse = z.object({
  requestId: Id,
  /** Seconds until another OTP may be requested (30 s throttle). */
  resendAfterSec: z.number().int().min(0),
  expiresAt: IsoUtc,
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponse>;

/**
 * The terms and privacy notice a new user agrees to at sign-up (DPDP Act 2023, spec backend-core
 * §10). Recorded with the user; a new version would ask existing users again.
 */
export const CONSENT_POLICY_VERSION = '2026-09-25';

export const OtpVerifyRequest = z.object({
  requestId: Id,
  mobile: Mobile,
  otp: Otp,
  /** Required once the server has answered CAPTCHA_REQUIRED (after 3 wrong attempts). */
  captchaToken: z.string().min(1).max(2048).optional(),
  /**
   * The consent checkbox on the mobile step (NSTOCK-0227). A new mobile without it answers 400
   * CONSENT_REQUIRED; an existing user is not asked again.
   */
  consentVersion: z.literal(CONSENT_POLICY_VERSION).optional(),
});
export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequest>;

export const KycStatus = z.enum(['NOT_STARTED', 'PENDING', 'VERIFIED']);
export type KycStatus = z.infer<typeof KycStatus>;

export const User = z.object({
  id: Id,
  /** Masked for display, e.g. `******3210`. The full number never leaves the API. */
  mobileMasked: z.string().regex(/^\*{6}\d{4}$/),
  name: z.string().min(1).max(100).nullable(),
  email: z.email().nullable(),
  /** Mocked in v1; no real KYC. */
  kycStatus: KycStatus,
  pinSet: z.boolean(),
  totpEnabled: z.boolean(),
  createdAt: IsoUtc,
});
export type User = z.infer<typeof User>;

export const Device = z.object({
  id: Id,
  /** Human label, e.g. `Chrome on macOS`. */
  label: z.string().min(1).max(100),
  trusted: z.boolean(),
  current: z.boolean(),
  createdAt: IsoUtc,
  lastSeenAt: IsoUtc,
});
export type Device = z.infer<typeof Device>;

/**
 * An authenticated session. The access token (15-min JWT) is returned in the body and kept in memory;
 * the rotating refresh token lives only in an httpOnly SameSite=Strict cookie.
 */
export const Session = z.object({
  user: User,
  device: Device,
  accessToken: z.string().min(1),
  accessTokenExpiresAt: IsoUtc,
  /**
   * Send as `X-CSRF-Token` on every POST, PUT, PATCH and DELETE while this session lasts. Kept in
   * memory only; a reload gets it back from `POST /v1/auth/refresh`.
   */
  csrfToken: z.string().min(16).max(256),
});
export type Session = z.infer<typeof Session>;

/**
 * The CSRF header (CLAUDE.md security baseline). Every state-changing `/v1` request must carry it,
 * or the server answers 403. With a session it must equal `Session.csrfToken`. Before a session
 * exists (OTP, PIN login, refresh after a reload) any non-empty value up to 256 characters is
 * accepted: a cross-site page cannot add a custom header without a CORS preflight, which the API
 * never grants, and the session cookies are SameSite=Strict.
 */
export const AUTH_CSRF_HEADER = 'x-csrf-token';

export const PinSetRequest = z
  .object({ pin: Pin, confirmPin: Pin })
  .refine((v) => v.pin === v.confirmPin, { error: 'PINs do not match', path: ['confirmPin'] });
export type PinSetRequest = z.infer<typeof PinSetRequest>;

export const PinSetResponse = z.object({ device: Device });
export type PinSetResponse = z.infer<typeof PinSetResponse>;

/** PIN login on a trusted device; the device is identified by its trusted-device cookie. */
export const PinVerifyRequest = z.object({ pin: Pin });
export type PinVerifyRequest = z.infer<typeof PinVerifyRequest>;

// ---- Auth rules ------------------------------------------------------------------------------
// Both mock backends (apps/api and the MSW handlers) enforce these, so the scenario suite can
// hold them to the same behaviour.

/** Seconds before another OTP may be requested for the same mobile. */
export const OTP_RESEND_AFTER_SEC = 30;
/** Seconds an OTP stays valid. */
export const OTP_TTL_SEC = 300;
/** Wrong OTP attempts after which a CAPTCHA is required (CLAUDE.md security baseline). */
export const OTP_CAPTCHA_AFTER_FAILURES = 3;
/** Wrong OTP attempts after which the OTP is burnt and a new one must be requested. */
export const OTP_MAX_FAILURES = 5;
/**
 * The fixed OTP the mock SMS provider uses outside production. Not a secret: production draws a
 * random OTP and never accepts this one.
 */
export const DEV_OTP = '123456';
/** The CAPTCHA token the mock CAPTCHA verifier accepts outside production. Never in production. */
export const DEV_CAPTCHA_TOKEN = 'dev-captcha-pass';

/**
 * `details` on auth errors (OTP_INVALID, CAPTCHA_REQUIRED, PIN_INVALID, PIN_LOCKED, RATE_LIMITED),
 * so the UI can show attempts left, a CAPTCHA, a countdown or "Unlock with OTP".
 */
export const AuthErrorDetails = z.object({
  captchaRequired: z.boolean().optional(),
  attemptsLeft: z.number().int().min(0).optional(),
  retryAfterSec: z.number().int().min(0).optional(),
  unlockWith: z.literal('OTP').optional(),
  /** TOTP_REQUIRED: the login challenge to send back to `totpVerify` with a code. */
  challengeId: Id.optional(),
  /** STEP_UP_REQUIRED: whether the step-up must also carry a TOTP code. */
  totpRequired: z.boolean().optional(),
  /** ACCOUNT_DELETED: when the account's data is erased for good. */
  purgeAfter: IsoUtc.optional(),
});
export type AuthErrorDetails = z.infer<typeof AuthErrorDetails>;

// ---- Sessions --------------------------------------------------------------------------------

/** Access token lifetime: 15 minutes (requirements BE-06). */
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
/** Refresh token lifetime; every refresh rotates it. */
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * Cookies apps/api sets, all httpOnly and SameSite=Strict:
 * - `access`: the 15-min access JWT (Path=/), also read by apps/realtime on the WS upgrade;
 * - `refresh`: the rotating refresh token (Path=/v1/auth);
 * - `device`: the trusted-device token set with the PIN (Path=/v1/auth, 180 days), which lets
 *   this browser log in with the PIN instead of an OTP. Logout keeps it.
 */
export const AUTH_COOKIES = {
  access: 'nth_at',
  refresh: 'nth_rt',
  device: 'nth_dev',
} as const;

export const ACCESS_TOKEN_ISSUER = 'nthstock-api';
export const ACCESS_TOKEN_AUDIENCE = 'nthstock';

/** Claims of the access JWT (HS256), shared by apps/api (signs) and apps/realtime (verifies). */
export const AccessTokenClaims = z.object({
  /** User id. */
  sub: Id,
  /** Session id; the refresh token family. Revoking it ends the session. */
  sid: Id,
  iss: z.literal(ACCESS_TOKEN_ISSUER),
  aud: z.literal(ACCESS_TOKEN_AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;

// ---- PIN -------------------------------------------------------------------------------------

/** Wrong PINs after which the account's PIN is locked until an OTP is verified. */
export const PIN_MAX_FAILURES = 5;
/** How long a device stays trusted for PIN login. */
export const TRUSTED_DEVICE_TTL_SEC = 180 * 24 * 60 * 60;

// ---- Step-up re-authentication (NSTOCK-0212, spec backend-core §7.3) -------------------------

/** How long a step-up lasts: sensitive actions within this window need no new proof. */
export const STEP_UP_WINDOW_SEC = 10 * 60;

/** A code from an authenticator app. */
export const TotpCode = z.string().regex(/^\d{6}$/, { error: 'Enter the 6-digit code' });
export type TotpCode = z.infer<typeof TotpCode>;

/**
 * A recovery code: 16 base32 characters, shown in groups of four (`ABCD-EFGH-JKLM-NPQR`). Case,
 * spaces and dashes are ignored, so the user can type it any way they read it.
 */
export const RecoveryCode = z
  .string()
  .transform((value) => value.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z2-7]{16}$/, { error: 'Enter a 16-character recovery code' }));
export type RecoveryCode = z.infer<typeof RecoveryCode>;

/**
 * Proof for a step-up: the PIN, or a `STEP_UP` OTP; plus a TOTP code when the user has two-factor
 * on (`AuthErrorDetails.totpRequired`).
 */
export const StepUpRequest = z
  .object({
    pin: Pin.optional(),
    requestId: Id.optional(),
    otp: Otp.optional(),
    totpCode: TotpCode.optional(),
  })
  .refine((v) => (v.pin !== undefined) !== (v.requestId !== undefined && v.otp !== undefined), {
    error: 'Send either the PIN or the OTP',
  });
export type StepUpRequest = z.infer<typeof StepUpRequest>;

export const StepUpResponse = z.object({ steppedUpUntil: IsoUtc });
export type StepUpResponse = z.infer<typeof StepUpResponse>;

// ---- TOTP two-factor (NSTOCK-0212, spec backend-core §7.4) ------------------------------------

/** The issuer authenticator apps show. */
export const TOTP_ISSUER = 'nthstock';
/** Seconds a pending enrolment can be confirmed. */
export const TOTP_ENROL_TTL_SEC = 10 * 60;
/** Seconds the login challenge after a PIN or OTP lives, waiting for the code. */
export const TOTP_CHALLENGE_TTL_SEC = 5 * 60;
/** Wrong codes after which the login challenge ends and the user starts again. */
export const TOTP_MAX_FAILURES = 5;
/** Recovery codes issued at a time, each usable once. */
export const TOTP_RECOVERY_CODE_COUNT = 10;

export const TotpEnrolResponse = z.object({
  /** The base32 secret, for typing into an app that cannot scan. */
  setupKey: z.string().regex(/^[A-Z2-7]{32}$/),
  /** `otpauth://totp/nthstock:******3210?…`; the QR code encodes it. */
  otpauthUri: z.string().startsWith('otpauth://totp/'),
  expiresAt: IsoUtc,
});
export type TotpEnrolResponse = z.infer<typeof TotpEnrolResponse>;

export const TotpCodeRequest = z.object({ code: TotpCode });
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

/** A current code or, when the phone is lost, one recovery code. */
export const TotpCodeOrRecoveryRequest = z
  .object({ code: TotpCode.optional(), recoveryCode: RecoveryCode.optional() })
  .refine((v) => (v.code === undefined) !== (v.recoveryCode === undefined), {
    error: 'Send a code or a recovery code',
  });
export type TotpCodeOrRecoveryRequest = z.infer<typeof TotpCodeOrRecoveryRequest>;

/** Recovery codes in display form (`ABCD-EFGH-JKLM-NPQR`). Shown once; only hashes are kept. */
export const TotpRecoveryCodesResponse = z.object({
  codes: z
    .array(z.string().regex(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/))
    .length(TOTP_RECOVERY_CODE_COUNT),
});
export type TotpRecoveryCodesResponse = z.infer<typeof TotpRecoveryCodesResponse>;

/** The login step after a PIN or OTP for a user with two-factor on. */
export const TotpVerifyRequest = z
  .object({ challengeId: Id, code: TotpCode.optional(), recoveryCode: RecoveryCode.optional() })
  .refine((v) => (v.code === undefined) !== (v.recoveryCode === undefined), {
    error: 'Send a code or a recovery code',
  });
export type TotpVerifyRequest = z.infer<typeof TotpVerifyRequest>;

// ---- Active sessions (NSTOCK-0222, spec backend-core §7.5) --------------------------------------

/**
 * One signed-in session of the user: the device it runs on, whether that device is trusted for
 * PIN login, and when it signed in and was last active. No IP address is stored or shown in v1.
 */
export const ActiveSession = z.object({
  id: Id,
  deviceLabel: z.string().min(1).max(120),
  trusted: z.boolean(),
  /** The session making this request ("This device"). */
  current: z.boolean(),
  createdAt: IsoUtc,
  lastActiveAt: IsoUtc,
});
export type ActiveSession = z.infer<typeof ActiveSession>;

/** Most recently active first. */
export const SessionsResponse = z.object({ sessions: z.array(ActiveSession) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

export const SessionParams = z.object({ id: Id });
export type SessionParams = z.infer<typeof SessionParams>;

export const RevokeOthersResponse = z.object({ revoked: z.number().int().min(0) });
export type RevokeOthersResponse = z.infer<typeof RevokeOthersResponse>;

// ---- Account deletion (NSTOCK-0227, spec backend-core §10) ------------------------------------

/** Days between asking to delete the account and erasing its data. */
export const ACCOUNT_PURGE_AFTER_DAYS = 30;

/** The user types DELETE to confirm; nothing else is accepted. */
export const AccountDeletionRequest = z.object({ confirm: z.literal('DELETE') });
export type AccountDeletionRequest = z.infer<typeof AccountDeletionRequest>;

export const AccountDeletionResponse = z.object({ purgeAfter: IsoUtc });
export type AccountDeletionResponse = z.infer<typeof AccountDeletionResponse>;
