import { randomBytes } from 'node:crypto';
import {
  PIN_MAX_FAILURES,
  TRUSTED_DEVICE_TTL_SEC,
  type AuthErrorDetails,
} from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { UsersRepo } from '../users/repo.js';
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

/** PIN set and verify (T-081): Argon2id hashes, a trusted-device token, and a 5-strike lock. */
export function createPinService({
  clock,
  repo,
  users,
  sessions,
  hasher,
}: PinServiceDeps): PinService {
  async function trustedDevice(deviceToken: string | undefined) {
    if (!deviceToken) return null;
    const token = await repo.getDeviceToken(hashToken(deviceToken));
    if (!token || token.expiresAt <= clock.now()) return null;
    const device = await repo.getDevice(token.deviceId);
    return device?.trusted ? device : null;
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
      return { device, token, expiresAt };
    },

    async verify({ deviceToken, pin, userAgent }) {
      const device = await trustedDevice(deviceToken);
      if (!device) throw untrusted();
      const [user, stored] = await Promise.all([
        users.findById(device.userId),
        repo.getPin(device.userId),
      ]);
      if (!user || !stored) throw untrusted();
      if (stored.failures >= PIN_MAX_FAILURES) throw locked();

      if (!(await hasher.verify(stored.hash, pin))) {
        const failures = await repo.recordPinFailure(user.id);
        if (failures >= PIN_MAX_FAILURES) throw locked();
        throw new ApiHttpError(400, 'PIN_INVALID', 'Incorrect PIN. Please try again.', {
          attemptsLeft: PIN_MAX_FAILURES - failures,
        } satisfies AuthErrorDetails);
      }
      await repo.clearPinFailures(user.id);
      return sessions.start({ user, userAgent, deviceId: device.id });
    },

    trustedDevice,
    unlock: (userId) => repo.clearPinFailures(userId),
  };
}
