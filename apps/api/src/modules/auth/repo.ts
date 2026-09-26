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

/** A login session; its id is also the refresh token family. */
export type SessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** One refresh token, stored by the SHA-256 of its value. */
export type RefreshTokenRecord = {
  sessionId: string;
  expiresAt: Date;
  /** Set when the token was rotated; presenting it again is reuse. */
  usedAt: Date | null;
};

/**
 * Storage seam for auth state (ADR 0004 §3). In-memory in the mock phase; Redis (OTPs, throttles,
 * sessions) and Postgres (devices, PINs) implementations replace it later without changes to the
 * services. Methods that must be atomic under concurrency (counters) are single calls here so a
 * Redis version can use INCR.
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
  /** Replaces any earlier trusted-device token of the device. */
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
  /** Marks the session (the whole refresh token family) revoked. */
  revokeSession(id: string, at: Date): Promise<void>;

  putRefreshToken(hash: string, token: RefreshTokenRecord): Promise<void>;
  /**
   * Marks the token used and resolves to it as it was before this call, so exactly one caller sees
   * `usedAt: null` (a Redis version uses GETSET). Null when the token is unknown.
   */
  useRefreshToken(hash: string, at: Date): Promise<RefreshTokenRecord | null>;

  /** Drops all state. Tests call it between cases. */
  reset(): Promise<void>;
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
  expiresAt: new Date(s.expiresAt),
  revokedAt: s.revokedAt ? new Date(s.revokedAt) : null,
});

const copyRefresh = (r: RefreshTokenRecord): RefreshTokenRecord => ({
  ...r,
  expiresAt: new Date(r.expiresAt),
  usedAt: r.usedAt ? new Date(r.usedAt) : null,
});

export function createMemoryAuthRepo(): AuthRepo {
  const challenges = new Map<string, OtpChallenge>();
  const lastRequest = new Map<string, Date>();
  const devices = new Map<string, DeviceRecord>();
  const sessions = new Map<string, SessionRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();
  const deviceTokens = new Map<string, DeviceTokenRecord>();
  const pins = new Map<string, PinRecord>();

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
    createSession: (session) => {
      sessions.set(session.id, copySession(session));
      return Promise.resolve();
    },
    getSession: (id) => {
      const found = sessions.get(id);
      return Promise.resolve(found ? copySession(found) : null);
    },
    revokeSession: (id, at) => {
      const found = sessions.get(id);
      if (found && !found.revokedAt) found.revokedAt = new Date(at);
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
      challenges.clear();
      lastRequest.clear();
      devices.clear();
      sessions.clear();
      refreshTokens.clear();
      deviceTokens.clear();
      pins.clear();
      return Promise.resolve();
    },
  };
}
