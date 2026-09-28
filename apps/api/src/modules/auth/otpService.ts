import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  DEV_OTP,
  OTP_CAPTCHA_AFTER_FAILURES,
  OTP_MAX_FAILURES,
  OTP_RESEND_AFTER_SEC,
  OTP_TTL_SEC,
  type AuthErrorDetails,
  type OtpPurpose,
  type OtpRequest,
  type OtpRequestResponse,
  type OtpVerifyRequest,
} from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { AuditRepo } from '../audit/repo.js';
import type { UsersRepo } from '../users/repo.js';
import type { CaptchaVerifier } from './captcha.js';
import type { AuthRepo } from './repo.js';
import type { SmsProvider } from './smsProvider.js';

export type OtpServiceDeps = {
  clock: Clock;
  repo: AuthRepo;
  /** Finds whose login failed, for the LOGIN_FAILED entry (T-188). */
  users: UsersRepo;
  audit: AuditRepo;
  sms: SmsProvider;
  captcha: CaptchaVerifier;
  /** Production draws a random OTP; everywhere else the OTP is always `DEV_OTP`. */
  production: boolean;
  /** Request id generator; default `otp_<uuid>`. */
  newRequestId?: () => string;
  /** Random 6-digit OTP for production; injectable for tests. */
  randomOtp?: () => string;
};

export type VerifiedOtp = { mobile: string; purpose: OtpPurpose };

export type OtpService = {
  request(input: OtpRequest): Promise<OtpRequestResponse>;
  /** Checks the OTP and consumes it; throws an `ApiHttpError` for every failure. */
  verify(input: OtpVerifyRequest): Promise<VerifiedOtp>;
};

const hashOtp = (requestId: string, otp: string) =>
  createHash('sha256').update(`${requestId}:${otp}`).digest();

const sameHash = (a: Buffer, hex: string) => timingSafeEqual(a, Buffer.from(hex, 'hex'));

const secondsUntil = (from: Date, to: Date) =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 1000));

const otpError = (
  code: 'OTP_INVALID' | 'OTP_EXPIRED' | 'CAPTCHA_REQUIRED',
  message: string,
  details?: AuthErrorDetails,
) => new ApiHttpError(400, code, message, details);

const expired = () => otpError('OTP_EXPIRED', 'This OTP has expired. Request a new one.');

/**
 * OTP request and verify (T-079): one live OTP per mobile, a 30 s resend throttle, a CAPTCHA after
 * 3 wrong attempts and a burnt OTP after 5. OTPs are stored hashed and compared in constant time.
 *
 * Every failed verify writes one LOGIN_FAILED entry (T-188) with the method and the error code as
 * the reason, for the mobile's user or with no user for an unknown mobile; never the mobile or the
 * OTP. A successful one is audited as the session's LOGIN_SUCCESS.
 */
export function createOtpService({
  clock,
  repo,
  users,
  audit,
  sms,
  captcha,
  production,
  newRequestId = () => `otp_${randomUUID().replaceAll('-', '')}`,
  randomOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
}: OtpServiceDeps): OtpService {
  return {
    async request({ mobile, purpose }) {
      const now = clock.now();
      const last = await repo.getLastOtpRequestAt(mobile);
      if (last) {
        const resendAt = new Date(last.getTime() + OTP_RESEND_AFTER_SEC * 1000);
        if (resendAt > now) {
          const retryAfterSec = secondsUntil(now, resendAt);
          throw new ApiHttpError(
            429,
            'RATE_LIMITED',
            `Please wait ${String(retryAfterSec)} seconds before requesting another OTP.`,
            { retryAfterSec } satisfies AuthErrorDetails,
          );
        }
      }
      await repo.setLastOtpRequestAt(mobile, now);

      const requestId = newRequestId();
      const otp = production ? randomOtp() : DEV_OTP;
      const expiresAt = new Date(now.getTime() + OTP_TTL_SEC * 1000);
      await repo.putOtpChallenge({
        requestId,
        mobile,
        purpose,
        otpHash: hashOtp(requestId, otp).toString('hex'),
        failures: 0,
        createdAt: now,
        expiresAt,
      });
      await sms.sendOtp({ mobile, otp, purpose });
      return {
        requestId,
        resendAfterSec: OTP_RESEND_AFTER_SEC,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async verify(input) {
      try {
        return await check(input);
      } catch (error) {
        if (error instanceof ApiHttpError) {
          const user = await users.findByMobile(input.mobile);
          await audit.append({
            actor: { type: 'system' },
            userId: user?.id ?? null,
            action: 'LOGIN_FAILED',
            orderId: null,
            outcome: 'REFUSED',
            detail: { method: 'OTP', reason: error.code },
          });
        }
        throw error;
      }
    },
  };

  async function check({
    requestId,
    mobile,
    otp,
    captchaToken,
  }: OtpVerifyRequest): Promise<VerifiedOtp> {
    const challenge = await repo.getOtpChallenge(mobile);
    if (!challenge || challenge.requestId !== requestId) throw expired();
    if (challenge.expiresAt <= clock.now()) {
      await repo.consumeOtpChallenge(mobile, requestId);
      throw expired();
    }

    if (challenge.failures >= OTP_CAPTCHA_AFTER_FAILURES) {
      const passed = captchaToken ? await captcha.verify(captchaToken) : false;
      if (!passed) {
        throw otpError('CAPTCHA_REQUIRED', 'Complete the CAPTCHA to continue.', {
          captchaRequired: true,
          attemptsLeft: OTP_MAX_FAILURES - challenge.failures,
        });
      }
    }

    if (!sameHash(hashOtp(requestId, otp), challenge.otpHash)) {
      const failures = await repo.recordOtpFailure(mobile, requestId);
      if (failures === null) throw expired();
      if (failures >= OTP_MAX_FAILURES) {
        await repo.consumeOtpChallenge(mobile, requestId);
        throw otpError('OTP_INVALID', 'Too many wrong attempts. Request a new OTP.', {
          attemptsLeft: 0,
          captchaRequired: true,
        });
      }
      throw otpError('OTP_INVALID', 'Incorrect OTP. Please try again.', {
        attemptsLeft: OTP_MAX_FAILURES - failures,
        captchaRequired: failures >= OTP_CAPTCHA_AFTER_FAILURES,
      });
    }

    // Consuming is the commit point: two racing correct submissions cannot both log in.
    if (!(await repo.consumeOtpChallenge(mobile, requestId))) throw expired();
    return { mobile, purpose: challenge.purpose };
  }
}
