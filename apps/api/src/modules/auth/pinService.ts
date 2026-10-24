import { randomBytes } from 'node:crypto';
import {
  PIN_MAX_FAILURES,
  TRUSTED_DEVICE_TTL_SEC,
  type AuthErrorDetails,
} from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { AuditRepo } from '../audit/index.js';
import type { UserRecord, UsersRepo } from '../users/index.js';
import type { PinHasher } from './pinHasher.js';
import type { AuthRepo, DeviceRecord } from './repo.js';
import {
  hashToken,
  type AuthContext,
  type IssuedSession,
  type SessionService,
} from './sessionService.js';

export type PinServiceDeps = {
  clock: Clock;
  repo: AuthRepo;
  users: UsersRepo;
  sessions: SessionService;
  hasher: PinHasher;
  /** PIN_SET, PIN_LOCKED and failed PIN logins go here (T-188). */
  audit: AuditRepo;
};

export type TrustedDevice = { device: DeviceRecord; token: string; expiresAt: Date };

export type PinService = {
  /** Sets the PIN and trusts the session's device; returns the trusted-device token for the cookie. */
  set(context: AuthContext, pin: string): Promise<TrustedDevice>;
  /** PIN login on a trusted device. Five wrong PINs lock the account until an OTP is verified. */
  verify(input: {
    deviceToken: string | undefined;
    pin: string;
    userAgent: string | undefined;
  }): Promise<IssuedSession>;
  /**
   * The first factor of a PIN login, without the session: the user and the trusted device when
   * the PIN is right (a user with two-factor on still needs their code, NSTOCK-0216).
   */
  check(input: {
    deviceToken: string | undefined;
    pin: string;
  }): Promise<{ user: UserRecord; device: DeviceRecord }>;
  /**
   * Re-checks the signed-in user's PIN for a step-up (NSTOCK-0214), with the same lock; failures
   * are audited as a refused STEP_UP.
   */
  checkForStepUp(user: UserRecord, pin: string): Promise<void>;
  /** The trusted device behind a device token, or null. */
  trustedDevice(deviceToken: string | undefined): Promise<DeviceRecord | null>;
  /** Lifts the PIN lock (a verified OTP proves the owner). */
  unlock(userId: string): Promise<void>;
};

const untrusted = () =>
  new ApiHttpError(401, 'UNAUTHORIZED', "This device isn't set up for PIN login. Log in with OTP.");

const locked = () =>
  new ApiHttpError(423, 'PIN_LOCKED', 'Too many wrong PINs. Unlock with an OTP to continue.', {
    attemptsLeft: 0,
    unlockWith: 'OTP',
  } satisfies AuthErrorDetails);

/**
 * PIN set and verify (T-081): Argon2id hashes, a trusted-device token, and a 5-strike lock.
 *
 * Audited (T-188), one entry per attempt: setting the PIN is PIN_SET; a wrong PIN is
 * LOGIN_FAILED, except the one that locks the account, which is PIN_LOCKED; a PIN tried on an
 * untrusted device or a locked account is LOGIN_FAILED; a right one is the session's
 * LOGIN_SUCCESS. Never the PIN, the hash or the device token.
 */
export function createPinService({
  clock,
  repo,
  users,
  sessions,
  hasher,
  audit,
}: PinServiceDeps): PinService {
  const loginFailed = (
    userId: string | null,
    reason: string,
    detail: Record<string, unknown> = {},
  ) =>
    audit.append({
      actor: { type: 'system' },
      userId,
      action: 'LOGIN_FAILED',
      orderId: null,
      outcome: 'REFUSED',
      detail: { method: 'PIN', reason, ...detail },
    });

  async function trustedDevice(deviceToken: string | undefined) {
    if (!deviceToken) return null;
    const token = await repo.getDeviceToken(hashToken(deviceToken));
    if (!token || token.expiresAt <= clock.now()) return null;
    const device = await repo.getDevice(token.deviceId);
    return device?.trusted ? device : null;
  }

  /** Compares the PIN, counting a wrong one towards the lock (PIN_LOCKED on the fifth). */
  async function comparePin(
    user: UserRecord,
    stored: { hash: string; failures: number },
    pin: string,
    refused: (reason: string, detail: Record<string, unknown>) => Promise<unknown>,
    detail: Record<string, unknown> = {},
  ) {
    if (stored.failures >= PIN_MAX_FAILURES) {
      await refused('PIN_LOCKED', detail);
      throw locked();
    }
    if (!(await hasher.verify(stored.hash, pin))) {
      const failures = await repo.recordPinFailure(user.id);
      if (failures >= PIN_MAX_FAILURES) {
        await audit.append({
          actor: { type: 'system' },
          userId: user.id,
          action: 'PIN_LOCKED',
          orderId: null,
          outcome: 'REFUSED',
          detail: { ...detail, failures },
        });
        throw locked();
      }
      const attemptsLeft = PIN_MAX_FAILURES - failures;
      await refused('PIN_INVALID', { ...detail, attemptsLeft });
      throw new ApiHttpError(400, 'PIN_INVALID', 'Incorrect PIN. Please try again.', {
        attemptsLeft,
      } satisfies AuthErrorDetails);
    }
    await repo.clearPinFailures(user.id);
  }

  async function check({ deviceToken, pin }: { deviceToken: string | undefined; pin: string }) {
    const device = await trustedDevice(deviceToken);
    if (!device) {
      await loginFailed(null, 'UNAUTHORIZED');
      throw untrusted();
    }
    const [user, stored] = await Promise.all([
      users.findById(device.userId),
      repo.getPin(device.userId),
    ]);
    if (!user || !stored) {
      await loginFailed(user?.id ?? null, 'UNAUTHORIZED', { deviceId: device.id });
      throw untrusted();
    }
    await comparePin(user, stored, pin, (reason, detail) => loginFailed(user.id, reason, detail), {
      deviceId: device.id,
    });
    return { user, device };
  }

  return {
    async set(context, pin) {
      await repo.setPin(context.user.id, await hasher.hash(pin));
      await users.update(context.user.id, { pinSet: true });
      const device = (await repo.updateDevice(context.device.id, { trusted: true })) ?? {
        ...context.device,
        trusted: true,
      };
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(clock.now().getTime() + TRUSTED_DEVICE_TTL_SEC * 1000);
      await repo.putDeviceToken(hashToken(token), { deviceId: device.id, expiresAt });
      await audit.append({
        actor: { type: 'user', userId: context.user.id },
        userId: context.user.id,
        action: 'PIN_SET',
        orderId: null,
        outcome: 'OK',
        detail: { deviceId: device.id },
      });
      return { device, token, expiresAt };
    },

    async verify({ deviceToken, pin, userAgent }) {
      const { user, device } = await check({ deviceToken, pin });
      return sessions.start({ user, method: 'PIN', userAgent, deviceId: device.id });
    },

    check,

    async checkForStepUp(user, pin) {
      const stored = await repo.getPin(user.id);
      const refused = (reason: string, detail = {}) =>
        audit.append({
          actor: { type: 'user', userId: user.id },
          userId: user.id,
          action: 'STEP_UP',
          orderId: null,
          outcome: 'REFUSED',
          detail: { method: 'PIN', reason, ...detail },
        });
      if (!stored) {
        await refused('PIN_INVALID');
        throw new ApiHttpError(400, 'PIN_INVALID', 'Set a PIN first, or confirm with an OTP.');
      }
      await comparePin(user, stored, pin, (reason, detail) => refused(reason, detail));
    },

    trustedDevice,
    unlock: (userId) => repo.clearPinFailures(userId),
  };
}
