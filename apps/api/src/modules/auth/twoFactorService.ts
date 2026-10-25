import { randomBytes, randomUUID } from 'node:crypto';
import {
  RecoveryCode,
  STEP_UP_WINDOW_SEC,
  TOTP_CHALLENGE_TTL_SEC,
  TOTP_ENROL_TTL_SEC,
  TOTP_ISSUER,
  TOTP_MAX_FAILURES,
  TOTP_RECOVERY_CODE_COUNT,
  type AuthErrorDetails,
  type OtpRequestResponse,
  type StepUpRequest,
  type StepUpResponse,
  type TotpCodeOrRecoveryRequest,
  type TotpEnrolResponse,
  type TotpVerifyRequest,
} from '@nthstock/contracts';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp, type Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { AuditRepo } from '../audit/index.js';
import { raiseSecurityNotice, type SecurityNotices } from '../notifications/index.js';
import { maskMobile, type UserRecord, type UsersRepo } from '../users/index.js';
import type { OtpService } from './otpService.js';
import type { PinHasher } from './pinHasher.js';
import type { PinService } from './pinService.js';
import type { AuthRepo } from './repo.js';
import type { AuthContext, IssuedSession, SessionService } from './sessionService.js';

export type TwoFactorServiceDeps = {
  clock: Clock;
  repo: AuthRepo;
  users: UsersRepo;
  audit: AuditRepo;
  otp: OtpService;
  pins: PinService;
  sessions: SessionService;
  /** Hashes recovery codes (Argon2id in the app, like PINs). */
  hasher: PinHasher;
  /** Challenge id generator; default `tc_<uuid>`. */
  newChallengeId?: () => string;
  /** Turning two-factor on or off raises a security notification (NSTOCK-0382). */
  notices?: SecurityNotices;
};

export type TwoFactorService = {
  /** 403 STEP_UP_REQUIRED unless the session stepped up within `STEP_UP_WINDOW_SEC`. */
  requireStepUp(context: AuthContext): void;
  /** Sends a STEP_UP OTP to the signed-in user's own mobile. */
  requestStepUpOtp(context: AuthContext): Promise<OtpRequestResponse>;
  stepUp(context: AuthContext, request: StepUpRequest): Promise<StepUpResponse>;
  /**
   * The login gate after a right PIN or OTP: does nothing for a user without two-factor; for one
   * with it, stores a challenge and throws 401 TOTP_REQUIRED with its id.
   */
  requireCodeIfEnabled(
    user: UserRecord,
    method: 'OTP' | 'PIN',
    deviceId: string | null,
  ): Promise<void>;
  /** The login's code step: issues the session once the code or a recovery code is right. */
  verifyLogin(request: TotpVerifyRequest, userAgent: string | undefined): Promise<IssuedSession>;
  enrol(context: AuthContext): Promise<TotpEnrolResponse>;
  confirm(context: AuthContext, code: string): Promise<string[]>;
  disable(context: AuthContext, proof: TotpCodeOrRecoveryRequest): Promise<void>;
  regenerateRecoveryCodes(context: AuthContext, code: string): Promise<string[]>;
};

const totpInvalid = (attemptsLeft?: number) =>
  new ApiHttpError(
    400,
    'TOTP_INVALID',
    attemptsLeft === 0
      ? 'Too many wrong codes. Log in again.'
      : 'That code is not right. Check your authenticator app and try again.',
    attemptsLeft === undefined ? undefined : ({ attemptsLeft } satisfies AuthErrorDetails),
  );

const challengeEnded = () =>
  new ApiHttpError(401, 'UNAUTHORIZED', 'This sign-in has expired. Log in again.');

const notEnabled = () =>
  new ApiHttpError(409, 'CONFLICT', 'Two-factor authentication is not turned on.');

/** 10 random bytes are exactly 16 base32 characters: 80 bits per code. */
const newRecoveryCode = () => base32Encode(randomBytes(10));
/** `ABCDEFGHJKLMNPQR` → `ABCD-EFGH-JKLM-NPQR`, the form shown and downloaded. */
const displayRecoveryCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

/**
 * Step-up re-authentication (NSTOCK-0214) and TOTP two-factor (NSTOCK-0215, NSTOCK-0216), spec
 * backend-core §7.3 and §7.4.
 *
 * - Step-up: the PIN (same 5-strike lock as login) or a STEP_UP OTP, plus a TOTP code when the user
 *   has two-factor on, marks the session stepped up for 10 minutes. Sensitive routes call
 *   `requireStepUp` first and answer 403 STEP_UP_REQUIRED outside that window.
 * - TOTP codes go through `useTotpStep`, one conditional write that only moves the last accepted
 *   step forward: a code is accepted once, so a replayed or shoulder-surfed code fails.
 * - Recovery codes are Argon2id-hashed, shown once, and deleted when used.
 * - Every outcome is audited without the code, the secret or a recovery code.
 */
export function createTwoFactorService({
  clock,
  repo,
  users,
  audit,
  otp,
  pins,
  sessions,
  hasher,
  newChallengeId = () => `tc_${randomUUID().replaceAll('-', '')}`,
  notices,
}: TwoFactorServiceDeps): TwoFactorService {
  const record = (
    user: UserRecord,
    action: 'STEP_UP' | 'TOTP_ENABLED' | 'TOTP_DISABLED' | 'RECOVERY_CODE_USED',
    outcome: 'OK' | 'REFUSED',
    detail: Record<string, unknown>,
  ) =>
    audit.append({
      actor: { type: 'user', userId: user.id },
      userId: user.id,
      action,
      orderId: null,
      outcome,
      detail,
    });

  async function activeFactor(userId: string) {
    const factor = await repo.getTotpFactor(userId);
    return factor?.status === 'ACTIVE' ? factor : null;
  }

  /** A current code for the active factor, accepted once (replays fail). */
  async function codeIsRight(userId: string, code: string): Promise<boolean> {
    const factor = await activeFactor(userId);
    if (!factor) return false;
    const step = await verifyTotp(factor.secret, code, clock.now(), {
      afterStep: factor.lastUsedStep,
    });
    return step !== null && (await repo.useTotpStep(userId, step));
  }

  /** Uses one recovery code if it matches an unused one. */
  async function recoveryCodeIsRight(user: UserRecord, typed: string): Promise<boolean> {
    const parsed = RecoveryCode.safeParse(typed);
    if (!parsed.success) return false;
    for (const stored of await repo.listRecoveryCodes(user.id)) {
      if (await hasher.verify(stored.hash, parsed.data)) {
        if (!(await repo.useRecoveryCode(user.id, stored.id, clock.now()))) return false;
        const left = (await repo.listRecoveryCodes(user.id)).length;
        await record(user, 'RECOVERY_CODE_USED', 'OK', { left });
        return true;
      }
    }
    return false;
  }

  const secondFactorIsRight = (
    user: UserRecord,
    proof: { code?: string | undefined; recoveryCode?: string | undefined },
  ) =>
    proof.code !== undefined
      ? codeIsRight(user.id, proof.code)
      : proof.recoveryCode !== undefined
        ? recoveryCodeIsRight(user, proof.recoveryCode)
        : Promise.resolve(false);

  async function newRecoveryCodes() {
    const codes = Array.from({ length: TOTP_RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map((code) => hasher.hash(code)));
    return { display: codes.map(displayRecoveryCode), hashes };
  }

  function requireStepUp(context: AuthContext) {
    const at = context.session.steppedUpAt;
    if (at && clock.now().getTime() - at.getTime() < STEP_UP_WINDOW_SEC * 1000) return;
    throw new ApiHttpError(403, 'STEP_UP_REQUIRED', 'Confirm it is you to continue.', {
      totpRequired: context.user.totpEnabled,
    } satisfies AuthErrorDetails);
  }

  return {
    requireStepUp,

    requestStepUpOtp: (context) => otp.request({ mobile: context.user.mobile, purpose: 'STEP_UP' }),

    async stepUp(context, request) {
      const { user } = context;
      let method: 'PIN' | 'OTP';
      if (request.pin !== undefined) {
        method = 'PIN';
        await pins.checkForStepUp(user, request.pin);
      } else {
        method = 'OTP';
        const verified = await otp.verify({
          requestId: request.requestId ?? '',
          mobile: user.mobile,
          otp: request.otp ?? '',
        });
        if (verified.purpose !== 'STEP_UP') {
          throw new ApiHttpError(400, 'OTP_EXPIRED', 'This OTP has expired. Request a new one.');
        }
      }
      if (user.totpEnabled) {
        const right = request.totpCode ? await codeIsRight(user.id, request.totpCode) : false;
        if (!right) {
          await record(user, 'STEP_UP', 'REFUSED', { method, reason: 'TOTP_INVALID' });
          throw new ApiHttpError(
            400,
            'TOTP_INVALID',
            request.totpCode
              ? 'That code is not right. Check your authenticator app and try again.'
              : 'Enter the code from your authenticator app.',
            { totpRequired: true } satisfies AuthErrorDetails,
          );
        }
      }
      const now = clock.now();
      await repo.stepUpSession(context.session.id, now);
      await record(user, 'STEP_UP', 'OK', { method, sessionId: context.session.id });
      return {
        steppedUpUntil: new Date(now.getTime() + STEP_UP_WINDOW_SEC * 1000).toISOString(),
      };
    },

    async requireCodeIfEnabled(user, method, deviceId) {
      if (!user.totpEnabled) return;
      const now = clock.now();
      const challengeId = newChallengeId();
      await repo.putTotpChallenge({
        challengeId,
        userId: user.id,
        method,
        deviceId,
        failures: 0,
        createdAt: now,
        expiresAt: new Date(now.getTime() + TOTP_CHALLENGE_TTL_SEC * 1000),
      });
      throw new ApiHttpError(401, 'TOTP_REQUIRED', 'Enter the code from your authenticator app.', {
        challengeId,
      } satisfies AuthErrorDetails);
    },

    async verifyLogin(request, userAgent) {
      const challenge = await repo.getTotpChallenge(request.challengeId);
      if (!challenge || challenge.expiresAt <= clock.now()) throw challengeEnded();
      const user = await users.findById(challenge.userId);
      if (!user) throw challengeEnded();

      if (!(await secondFactorIsRight(user, request))) {
        const failures = await repo.recordTotpFailure(challenge.challengeId);
        if (failures === null) throw challengeEnded();
        const attemptsLeft = Math.max(0, TOTP_MAX_FAILURES - failures);
        await audit.append({
          actor: { type: 'system' },
          userId: user.id,
          action: 'LOGIN_FAILED',
          orderId: null,
          outcome: 'REFUSED',
          detail: { method: 'TOTP', reason: 'TOTP_INVALID', attemptsLeft },
        });
        if (attemptsLeft === 0) await repo.consumeTotpChallenge(challenge.challengeId);
        throw totpInvalid(attemptsLeft);
      }
      // Consuming is the commit point: one challenge, one session.
      if (!(await repo.consumeTotpChallenge(challenge.challengeId))) throw challengeEnded();
      // A verified OTP lifts a PIN lock, once the whole login has passed.
      if (challenge.method === 'OTP') await pins.unlock(user.id);
      return sessions.start({ user, method: 'TOTP', userAgent, deviceId: challenge.deviceId });
    },

    async enrol(context) {
      requireStepUp(context);
      const now = clock.now();
      const secret = newTotpSecret();
      const stored = await repo.putPendingTotpFactor({
        userId: context.user.id,
        secret,
        status: 'PENDING',
        lastUsedStep: 0,
        createdAt: now,
        confirmedAt: null,
      });
      if (!stored) {
        throw new ApiHttpError(409, 'CONFLICT', 'Two-factor authentication is already on.');
      }
      return {
        setupKey: base32Encode(secret),
        otpauthUri: otpauthUri({
          issuer: TOTP_ISSUER,
          label: maskMobile(context.user.mobile),
          secret,
        }),
        expiresAt: new Date(now.getTime() + TOTP_ENROL_TTL_SEC * 1000).toISOString(),
      };
    },

    async confirm(context, code) {
      requireStepUp(context);
      const now = clock.now();
      const factor = await repo.getTotpFactor(context.user.id);
      if (factor?.status === 'ACTIVE') {
        throw new ApiHttpError(409, 'CONFLICT', 'Two-factor authentication is already on.');
      }
      if (!factor || now.getTime() - factor.createdAt.getTime() > TOTP_ENROL_TTL_SEC * 1000) {
        throw new ApiHttpError(409, 'CONFLICT', 'This setup has expired. Start again.');
      }
      const step = await verifyTotp(factor.secret, code, now);
      if (step === null) throw totpInvalid();
      const { display, hashes } = await newRecoveryCodes();
      const activated = await repo.activateTotpFactor(context.user.id, {
        at: now,
        step,
        recoveryCodeHashes: hashes,
      });
      if (!activated) {
        throw new ApiHttpError(409, 'CONFLICT', 'This setup has expired. Start again.');
      }
      await users.update(context.user.id, { totpEnabled: true });
      await record(context.user, 'TOTP_ENABLED', 'OK', { sessionId: context.session.id });
      raiseSecurityNotice(notices, context.user.id, { type: 'TOTP_ENABLED' }, now);
      return display;
    },

    async disable(context, proof) {
      requireStepUp(context);
      if (!(await activeFactor(context.user.id))) throw notEnabled();
      if (!(await secondFactorIsRight(context.user, proof))) {
        await record(context.user, 'TOTP_DISABLED', 'REFUSED', { reason: 'TOTP_INVALID' });
        throw totpInvalid();
      }
      await repo.deleteTotpFactor(context.user.id);
      await users.update(context.user.id, { totpEnabled: false });
      await record(context.user, 'TOTP_DISABLED', 'OK', {
        with: proof.code === undefined ? 'RECOVERY_CODE' : 'CODE',
      });
      raiseSecurityNotice(notices, context.user.id, { type: 'TOTP_DISABLED' }, clock.now());
    },

    async regenerateRecoveryCodes(context, code) {
      requireStepUp(context);
      if (!(await activeFactor(context.user.id))) throw notEnabled();
      if (!(await codeIsRight(context.user.id, code))) throw totpInvalid();
      const { display, hashes } = await newRecoveryCodes();
      await repo.replaceRecoveryCodes(context.user.id, hashes);
      await audit.append({
        actor: { type: 'user', userId: context.user.id },
        userId: context.user.id,
        action: 'RECOVERY_CODES_REGENERATED',
        orderId: null,
        outcome: 'OK',
        detail: { count: hashes.length },
      });
      return display;
    },
  };
}
