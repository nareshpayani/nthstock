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

export const OtpPurpose = z.enum(['LOGIN', 'UNLOCK_PIN']);
export type OtpPurpose = z.infer<typeof OtpPurpose>;

export const OtpRequest = z.object({
  mobile: Mobile,
  purpose: OtpPurpose.default('LOGIN'),
});
export type OtpRequest = z.infer<typeof OtpRequest>;

export const OtpRequestResponse = z.object({
  requestId: Id,
  /** Seconds until another OTP may be requested (30 s throttle). */
  resendAfterSec: z.number().int().min(0),
  expiresAt: IsoUtc,
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponse>;

export const OtpVerifyRequest = z.object({
  requestId: Id,
  mobile: Mobile,
  otp: Otp,
  /** Required once the server has answered CAPTCHA_REQUIRED (after 3 wrong attempts). */
  captchaToken: z.string().min(1).max(2048).optional(),
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
});
export type Session = z.infer<typeof Session>;

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
