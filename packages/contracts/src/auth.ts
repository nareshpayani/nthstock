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
