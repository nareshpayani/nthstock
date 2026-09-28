import type { OtpPurpose } from '@nthstock/contracts';

/** One outstanding OTP. Only a hash of the code is stored. */
export type OtpChallenge = {
  requestId: string;
  mobile: string;
  purpose: OtpPurpose;
  otpHash: string;
  failures: number;
  createdAt: Date;
  expiresAt: Date;
};

/** A device a user logged in from. */
export type DeviceRecord = {
  id: string;
  userId: string;
  label: string;
  trusted: boolean;
  createdAt: Date;
  lastSeenAt: Date;
};

/** A user's PIN: an Argon2id hash (never the PIN) and the wrong-attempt count behind the lock. */
export type PinRecord = {
  hash: string;
  failures: number;
};

/** A trusted-device token, stored by the SHA-256 of its value. */
export type DeviceTokenRecord = {
  deviceId: string;
  expiresAt: Date;
};

/** Why a session ended (spec backend-core §4.1). */
export const SESSION_REVOKED_REASONS = [
  'LOGOUT',
  'USER_REVOKED',
  'REUSE_DETECTED',
  'ACCOUNT_DELETED',
  'FACTOR_CHANGED',
] as const;
export type SessionRevokedReason = (typeof SESSION_REVOKED_REASONS)[number];

/** A login session; its id is also the refresh token family. */
export type SessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  /** Must come back as the CSRF header on cookie-authenticated state-changing requests. */
  csrfToken: string;
  createdAt: Date;
  /** Last authenticated request or refresh, written at most about once a minute. */
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Set together with `revokedAt`. */
  revokedReason: SessionRevokedReason | null;
};

/** One refresh token, stored by the SHA-256 of its value. */
export type RefreshTokenRecord = {
  sessionId: string;
  expiresAt: Date;
  /** Set when the token was rotated; presenting it again is reuse. */
  usedAt: Date | null;
};

/**
 * Storage seam for auth state (ADR 0004 §3, ADR 0007). Callers see one interface; inside it is
 * three stores that live in different places (spec backend-core §5.2):
 *
 * - `OtpStore`: OTP challenges and the resend throttle; short-lived (memory or Redis).
 * - `DeviceStore`: devices, trusted-device tokens and PINs (memory or Postgres).
 * - `SessionStore`: sessions and refresh tokens (memory or Postgres).
 *
 * Methods that must be atomic under concurrency (counters, one-time use) are single calls, so a
 * Postgres or Redis store implements each as one statement or script.
 */
export interface AuthRepo {
  /** Stores the mobile's current OTP, replacing any earlier one (only the latest OTP works). */
  putOtpChallenge(challenge: OtpChallenge): Promise<void>;
  getOtpChallenge(mobile: string): Promise<OtpChallenge | null>;
  /** Adds one wrong attempt; resolves to the new count, or null when the challenge is gone. */
  recordOtpFailure(mobile: string, requestId: string): Promise<number | null>;
  /** Removes the challenge if it is still `requestId`; resolves true when this call removed it. */
  consumeOtpChallenge(mobile: string, requestId: string): Promise<boolean>;
  /** When an OTP was last requested for the mobile (resend throttle). */
  getLastOtpRequestAt(mobile: string): Promise<Date | null>;
  setLastOtpRequestAt(mobile: string, at: Date): Promise<void>;

  createDevice(device: DeviceRecord): Promise<void>;
  getDevice(id: string): Promise<DeviceRecord | null>;
  updateDevice(
    id: string,
    patch: Partial<Pick<DeviceRecord, 'trusted' | 'lastSeenAt'>>,
  ): Promise<DeviceRecord | null>;
  /** Replaces any earlier trusted-device token of the device. `hash` is its SHA-256 in hex. */
  putDeviceToken(hash: string, token: DeviceTokenRecord): Promise<void>;
  getDeviceToken(hash: string): Promise<DeviceTokenRecord | null>;

  /** Stores a new PIN hash and clears the wrong-attempt count. */
  setPin(userId: string, hash: string): Promise<void>;
  getPin(userId: string): Promise<PinRecord | null>;
  /** Adds one wrong attempt; resolves to the new count (0 when the user has no PIN). */
  recordPinFailure(userId: string): Promise<number>;
  /** Clears the wrong-attempt count, which also lifts the lock. */
  clearPinFailures(userId: string): Promise<void>;

  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  /**
   * Marks the session (the whole refresh token family) revoked, for `reason`. A session already
   * revoked keeps its first time and reason.
   */
  revokeSession(id: string, at: Date, reason: SessionRevokedReason): Promise<void>;
  /**
   * Sets the session's `lastSeenAt` to `at` only if it is at or before `staleBefore`, in one
   * conditional write, so instances racing on one session write it once.
   */
  touchSession(id: string, at: Date, staleBefore: Date): Promise<void>;

  /** `hash` is the SHA-256 of the token in hex. */
  putRefreshToken(hash: string, token: RefreshTokenRecord): Promise<void>;
  /**
   * Marks the token used and resolves to it as it was before this call, so exactly one caller sees
   * `usedAt: null`. Null when the token is unknown.
   */
  useRefreshToken(hash: string, at: Date): Promise<RefreshTokenRecord | null>;

  /** Tests only: drops all state. Postgres stores refuse (tests truncate as the owner). */
  reset(): Promise<void>;
}

type Resettable = { reset(): Promise<void> };

export type OtpStore = Pick<
  AuthRepo,
  | 'putOtpChallenge'
  | 'getOtpChallenge'
  | 'recordOtpFailure'
  | 'consumeOtpChallenge'
  | 'getLastOtpRequestAt'
  | 'setLastOtpRequestAt'
> &
  Resettable;

export type DeviceStore = Pick<
  AuthRepo,
  | 'createDevice'
  | 'getDevice'
  | 'updateDevice'
  | 'putDeviceToken'
  | 'getDeviceToken'
  | 'setPin'
  | 'getPin'
  | 'recordPinFailure'
  | 'clearPinFailures'
> &
  Resettable;

export type SessionStore = Pick<
  AuthRepo,
  | 'createSession'
  | 'getSession'
  | 'revokeSession'
  | 'touchSession'
  | 'putRefreshToken'
  | 'useRefreshToken'
> &
  Resettable;

/** One AuthRepo from its three stores. */
export function composeAuthRepo(stores: {
  otp: OtpStore;
  devices: DeviceStore;
  sessions: SessionStore;
}): AuthRepo {
  const { otp, devices, sessions } = stores;
  return {
    putOtpChallenge: (challenge) => otp.putOtpChallenge(challenge),
    getOtpChallenge: (mobile) => otp.getOtpChallenge(mobile),
    recordOtpFailure: (mobile, requestId) => otp.recordOtpFailure(mobile, requestId),
    consumeOtpChallenge: (mobile, requestId) => otp.consumeOtpChallenge(mobile, requestId),
    getLastOtpRequestAt: (mobile) => otp.getLastOtpRequestAt(mobile),
    setLastOtpRequestAt: (mobile, at) => otp.setLastOtpRequestAt(mobile, at),
    createDevice: (device) => devices.createDevice(device),
    getDevice: (id) => devices.getDevice(id),
    updateDevice: (id, patch) => devices.updateDevice(id, patch),
    putDeviceToken: (hash, token) => devices.putDeviceToken(hash, token),
    getDeviceToken: (hash) => devices.getDeviceToken(hash),
    setPin: (userId, hash) => devices.setPin(userId, hash),
    getPin: (userId) => devices.getPin(userId),
    recordPinFailure: (userId) => devices.recordPinFailure(userId),
    clearPinFailures: (userId) => devices.clearPinFailures(userId),
    createSession: (session) => sessions.createSession(session),
    getSession: (id) => sessions.getSession(id),
    revokeSession: (id, at, reason) => sessions.revokeSession(id, at, reason),
    touchSession: (id, at, staleBefore) => sessions.touchSession(id, at, staleBefore),
    putRefreshToken: (hash, token) => sessions.putRefreshToken(hash, token),
    useRefreshToken: (hash, at) => sessions.useRefreshToken(hash, at),
    reset: async () => {
      await Promise.all([otp.reset(), devices.reset(), sessions.reset()]);
    },
  };
}

const copyChallenge = (c: OtpChallenge): OtpChallenge => ({
  ...c,
  createdAt: new Date(c.createdAt),
  expiresAt: new Date(c.expiresAt),
});

const copyDevice = (d: DeviceRecord): DeviceRecord => ({
  ...d,
  createdAt: new Date(d.createdAt),
  lastSeenAt: new Date(d.lastSeenAt),
});

const copySession = (s: SessionRecord): SessionRecord => ({
  ...s,
  createdAt: new Date(s.createdAt),
  lastSeenAt: new Date(s.lastSeenAt),
  expiresAt: new Date(s.expiresAt),
  revokedAt: s.revokedAt ? new Date(s.revokedAt) : null,
});

const copyRefresh = (r: RefreshTokenRecord): RefreshTokenRecord => ({
  ...r,
  expiresAt: new Date(r.expiresAt),
  usedAt: r.usedAt ? new Date(r.usedAt) : null,
});

export function createMemoryOtpStore(): OtpStore {
  const challenges = new Map<string, OtpChallenge>();
  const lastRequest = new Map<string, Date>();
  return {
    putOtpChallenge: (challenge) => {
      challenges.set(challenge.mobile, copyChallenge(challenge));
      return Promise.resolve();
    },
    getOtpChallenge: (mobile) => {
      const found = challenges.get(mobile);
      return Promise.resolve(found ? copyChallenge(found) : null);
    },
    recordOtpFailure: (mobile, requestId) => {
      const found = challenges.get(mobile);
      if (!found || found.requestId !== requestId) return Promise.resolve(null);
      found.failures += 1;
      return Promise.resolve(found.failures);
    },
    consumeOtpChallenge: (mobile, requestId) => {
      const found = challenges.get(mobile);
      if (!found || found.requestId !== requestId) return Promise.resolve(false);
      challenges.delete(mobile);
      return Promise.resolve(true);
    },
    getLastOtpRequestAt: (mobile) => {
      const at = lastRequest.get(mobile);
      return Promise.resolve(at ? new Date(at) : null);
    },
    setLastOtpRequestAt: (mobile, at) => {
      lastRequest.set(mobile, new Date(at));
      return Promise.resolve();
    },
    reset: () => {
      challenges.clear();
      lastRequest.clear();
      return Promise.resolve();
    },
  };
}

export function createMemoryDeviceStore(): DeviceStore {
  const devices = new Map<string, DeviceRecord>();
  const deviceTokens = new Map<string, DeviceTokenRecord>();
  const pins = new Map<string, PinRecord>();
  return {
    createDevice: (device) => {
      devices.set(device.id, copyDevice(device));
      return Promise.resolve();
    },
    getDevice: (id) => {
      const found = devices.get(id);
      return Promise.resolve(found ? copyDevice(found) : null);
    },
    updateDevice: (id, patch) => {
      const found = devices.get(id);
      if (!found) return Promise.resolve(null);
      const next = copyDevice({ ...found, ...patch });
      devices.set(id, next);
      return Promise.resolve(copyDevice(next));
    },
    putDeviceToken: (hash, token) => {
      for (const [key, existing] of deviceTokens) {
        if (existing.deviceId === token.deviceId) deviceTokens.delete(key);
      }
      deviceTokens.set(hash, { ...token, expiresAt: new Date(token.expiresAt) });
      return Promise.resolve();
    },
    getDeviceToken: (hash) => {
      const found = deviceTokens.get(hash);
      return Promise.resolve(found ? { ...found, expiresAt: new Date(found.expiresAt) } : null);
    },
    setPin: (userId, hash) => {
      pins.set(userId, { hash, failures: 0 });
      return Promise.resolve();
    },
    getPin: (userId) => {
      const found = pins.get(userId);
      return Promise.resolve(found ? { ...found } : null);
    },
    recordPinFailure: (userId) => {
      const found = pins.get(userId);
      if (!found) return Promise.resolve(0);
      found.failures += 1;
      return Promise.resolve(found.failures);
    },
    clearPinFailures: (userId) => {
      const found = pins.get(userId);
      if (found) found.failures = 0;
      return Promise.resolve();
    },
    reset: () => {
      devices.clear();
      deviceTokens.clear();
      pins.clear();
      return Promise.resolve();
    },
  };
}

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, SessionRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();
  return {
    createSession: (session) => {
      sessions.set(session.id, copySession(session));
      return Promise.resolve();
    },
    getSession: (id) => {
      const found = sessions.get(id);
      return Promise.resolve(found ? copySession(found) : null);
    },
    revokeSession: (id, at, reason) => {
      const found = sessions.get(id);
      if (found && !found.revokedAt) {
        found.revokedAt = new Date(at);
        found.revokedReason = reason;
      }
      return Promise.resolve();
    },
    touchSession: (id, at, staleBefore) => {
      const found = sessions.get(id);
      if (found && found.lastSeenAt <= staleBefore) found.lastSeenAt = new Date(at);
      return Promise.resolve();
    },
    putRefreshToken: (hash, token) => {
      refreshTokens.set(hash, copyRefresh(token));
      return Promise.resolve();
    },
    useRefreshToken: (hash, at) => {
      const found = refreshTokens.get(hash);
      if (!found) return Promise.resolve(null);
      const before = copyRefresh(found);
      found.usedAt ??= new Date(at);
      return Promise.resolve(before);
    },
    reset: () => {
      sessions.clear();
      refreshTokens.clear();
      return Promise.resolve();
    },
  };
}

/** Everything in process memory (unit tests, `DB_DRIVER=memory`). */
export function createMemoryAuthRepo(): AuthRepo {
  return composeAuthRepo({
    otp: createMemoryOtpStore(),
    devices: createMemoryDeviceStore(),
    sessions: createMemorySessionStore(),
  });
}
