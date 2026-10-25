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

/**
 * A login waiting for its TOTP code (NSTOCK-0216): the PIN or OTP was right, the user has
 * two-factor on. It lives `TOTP_CHALLENGE_TTL_SEC` and dies after `TOTP_MAX_FAILURES` wrong codes.
 */
export type TotpChallenge = {
  challengeId: string;
  userId: string;
  /** How the first factor was proved (the session's LOGIN_SUCCESS records `TOTP` after it). */
  method: 'OTP' | 'PIN';
  /** The trusted device the first factor came from, kept for the session. */
  deviceId: string | null;
  failures: number;
  createdAt: Date;
  expiresAt: Date;
};

/** A user's TOTP factor (NSTOCK-0215): `PENDING` from enrol until a code confirms it. */
export type TotpFactorRecord = {
  userId: string;
  /** The raw 20-byte secret; Postgres stores it encrypted (`db/crypto.ts`). */
  secret: Uint8Array;
  status: 'PENDING' | 'ACTIVE';
  /** The last TOTP step accepted; a code for this step or an earlier one is a replay. */
  lastUsedStep: number;
  createdAt: Date;
  confirmedAt: Date | null;
};

/** One unused recovery code: an Argon2id hash, never the code. */
export type RecoveryCodeRecord = { id: string; hash: string };

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
  /** The last step-up re-authentication (spec backend-core §7.3), or null. */
  steppedUpAt: Date | null;
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
 * A refresh token as `useRefreshToken` found it, with whether its session was already revoked at
 * that moment (read in the same step, so a concurrent reuse revoking the family cannot be seen
 * half-way through a rotation).
 */
export type RefreshTokenUse = RefreshTokenRecord & { sessionRevokedAt: Date | null };

/** An expired session is deleted this many days after `expiresAt` (spec backend-core §9). */
const EXPIRED_SESSION_RETENTION_DAYS = 30;
const EXPIRED_SESSION_RETENTION_MS = EXPIRED_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** What `deleteExpired` removed, as counts (the cleanup job logs them). */
export type ExpiredAuthCleanup = { refreshTokens: number; deviceTokens: number; sessions: number };

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

  putTotpChallenge(challenge: TotpChallenge): Promise<void>;
  getTotpChallenge(challengeId: string): Promise<TotpChallenge | null>;
  /** Adds one wrong code; resolves to the new count, or null when the challenge is gone. */
  recordTotpFailure(challengeId: string): Promise<number | null>;
  /** Removes the challenge; resolves true when this call removed it (one login per challenge). */
  consumeTotpChallenge(challengeId: string): Promise<boolean>;

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

  getTotpFactor(userId: string): Promise<TotpFactorRecord | null>;
  /** Stores a new PENDING factor, replacing a pending one; resolves false if one is ACTIVE. */
  putPendingTotpFactor(factor: TotpFactorRecord): Promise<boolean>;
  /**
   * PENDING → ACTIVE with the confirming code's step and new recovery codes, in one step;
   * resolves false when there was no pending factor.
   */
  activateTotpFactor(
    userId: string,
    input: { at: Date; step: number; recoveryCodeHashes: readonly string[] },
  ): Promise<boolean>;
  /** Deletes the factor and every recovery code. */
  deleteTotpFactor(userId: string): Promise<void>;
  /**
   * Accepts `step` for the active factor only if it is after the last one accepted, in one
   * conditional write, so a code replayed (even concurrently) is accepted once.
   */
  useTotpStep(userId: string, step: number): Promise<boolean>;
  listRecoveryCodes(userId: string): Promise<RecoveryCodeRecord[]>;
  /** Marks a recovery code used; resolves true for the one caller that did. */
  useRecoveryCode(userId: string, id: string, at: Date): Promise<boolean>;
  /** Replaces every unused recovery code. */
  replaceRecoveryCodes(userId: string, hashes: readonly string[]): Promise<void>;

  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  /** The user's sessions neither revoked nor expired at `at`, most recently active first. */
  listActiveSessions(userId: string, at: Date): Promise<SessionRecord[]>;
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
  /** Records a step-up on the session. */
  stepUpSession(id: string, at: Date): Promise<void>;

  /** `hash` is the SHA-256 of the token in hex. */
  putRefreshToken(hash: string, token: RefreshTokenRecord): Promise<void>;
  /**
   * Marks the token used and resolves to it as it was before this call, so exactly one caller sees
   * `usedAt: null`. Null when the token is unknown.
   */
  useRefreshToken(hash: string, at: Date): Promise<RefreshTokenUse | null>;

  /**
   * The `auth.tokenCleanup` job (T-210): deletes refresh and trusted-device tokens expired before
   * `now`, and sessions expired more than `EXPIRED_SESSION_RETENTION_DAYS` before it (with the
   * refresh tokens still left in their families). Live rows are never touched.
   */
  deleteExpired(now: Date): Promise<ExpiredAuthCleanup>;

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
  | 'putTotpChallenge'
  | 'getTotpChallenge'
  | 'recordTotpFailure'
  | 'consumeTotpChallenge'
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
  | 'getTotpFactor'
  | 'putPendingTotpFactor'
  | 'activateTotpFactor'
  | 'deleteTotpFactor'
  | 'useTotpStep'
  | 'listRecoveryCodes'
  | 'useRecoveryCode'
  | 'replaceRecoveryCodes'
> & {
  /** Deletes trusted-device tokens expired before `now`; resolves to how many. */
  deleteExpiredDeviceTokens(now: Date): Promise<number>;
} & Resettable;

export type SessionStore = Pick<
  AuthRepo,
  | 'createSession'
  | 'getSession'
  | 'listActiveSessions'
  | 'revokeSession'
  | 'touchSession'
  | 'stepUpSession'
  | 'putRefreshToken'
  | 'useRefreshToken'
> & {
  /**
   * Deletes refresh tokens expired before `now`, then sessions expired before `sessionsBefore`
   * together with their remaining refresh tokens (counted as sessions, not tokens).
   */
  deleteExpiredSessions(
    now: Date,
    sessionsBefore: Date,
  ): Promise<Pick<ExpiredAuthCleanup, 'refreshTokens' | 'sessions'>>;
} & Resettable;

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
    putTotpChallenge: (challenge) => otp.putTotpChallenge(challenge),
    getTotpChallenge: (id) => otp.getTotpChallenge(id),
    recordTotpFailure: (id) => otp.recordTotpFailure(id),
    consumeTotpChallenge: (id) => otp.consumeTotpChallenge(id),
    createDevice: (device) => devices.createDevice(device),
    getDevice: (id) => devices.getDevice(id),
    updateDevice: (id, patch) => devices.updateDevice(id, patch),
    putDeviceToken: (hash, token) => devices.putDeviceToken(hash, token),
    getDeviceToken: (hash) => devices.getDeviceToken(hash),
    setPin: (userId, hash) => devices.setPin(userId, hash),
    getPin: (userId) => devices.getPin(userId),
    recordPinFailure: (userId) => devices.recordPinFailure(userId),
    clearPinFailures: (userId) => devices.clearPinFailures(userId),
    getTotpFactor: (userId) => devices.getTotpFactor(userId),
    putPendingTotpFactor: (factor) => devices.putPendingTotpFactor(factor),
    activateTotpFactor: (userId, input) => devices.activateTotpFactor(userId, input),
    deleteTotpFactor: (userId) => devices.deleteTotpFactor(userId),
    useTotpStep: (userId, step) => devices.useTotpStep(userId, step),
    listRecoveryCodes: (userId) => devices.listRecoveryCodes(userId),
    useRecoveryCode: (userId, id, at) => devices.useRecoveryCode(userId, id, at),
    replaceRecoveryCodes: (userId, hashes) => devices.replaceRecoveryCodes(userId, hashes),
    createSession: (session) => sessions.createSession(session),
    getSession: (id) => sessions.getSession(id),
    listActiveSessions: (userId, at) => sessions.listActiveSessions(userId, at),
    revokeSession: (id, at, reason) => sessions.revokeSession(id, at, reason),
    touchSession: (id, at, staleBefore) => sessions.touchSession(id, at, staleBefore),
    stepUpSession: (id, at) => sessions.stepUpSession(id, at),
    putRefreshToken: (hash, token) => sessions.putRefreshToken(hash, token),
    useRefreshToken: (hash, at) => sessions.useRefreshToken(hash, at),
    deleteExpired: async (now) => {
      const sessionsBefore = new Date(now.getTime() - EXPIRED_SESSION_RETENTION_MS);
      const [deviceTokens, removed] = await Promise.all([
        devices.deleteExpiredDeviceTokens(now),
        sessions.deleteExpiredSessions(now, sessionsBefore),
      ]);
      return { refreshTokens: removed.refreshTokens, deviceTokens, sessions: removed.sessions };
    },
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
  steppedUpAt: s.steppedUpAt ? new Date(s.steppedUpAt) : null,
  revokedAt: s.revokedAt ? new Date(s.revokedAt) : null,
});

const copyTotpChallenge = (c: TotpChallenge): TotpChallenge => ({
  ...c,
  createdAt: new Date(c.createdAt),
  expiresAt: new Date(c.expiresAt),
});

const copyFactor = (f: TotpFactorRecord): TotpFactorRecord => ({
  ...f,
  secret: Uint8Array.from(f.secret),
  createdAt: new Date(f.createdAt),
  confirmedAt: f.confirmedAt ? new Date(f.confirmedAt) : null,
});

const copyRefresh = (r: RefreshTokenRecord): RefreshTokenRecord => ({
  ...r,
  expiresAt: new Date(r.expiresAt),
  usedAt: r.usedAt ? new Date(r.usedAt) : null,
});

export function createMemoryOtpStore(): OtpStore {
  const challenges = new Map<string, OtpChallenge>();
  const lastRequest = new Map<string, Date>();
  const totpChallenges = new Map<string, TotpChallenge>();
  return {
    putTotpChallenge: (challenge) => {
      totpChallenges.set(challenge.challengeId, copyTotpChallenge(challenge));
      return Promise.resolve();
    },
    getTotpChallenge: (id) => {
      const found = totpChallenges.get(id);
      return Promise.resolve(found ? copyTotpChallenge(found) : null);
    },
    recordTotpFailure: (id) => {
      const found = totpChallenges.get(id);
      if (!found) return Promise.resolve(null);
      found.failures += 1;
      return Promise.resolve(found.failures);
    },
    consumeTotpChallenge: (id) => Promise.resolve(totpChallenges.delete(id)),
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
      totpChallenges.clear();
      return Promise.resolve();
    },
  };
}

function createMemoryDeviceStore(): DeviceStore {
  const devices = new Map<string, DeviceRecord>();
  const deviceTokens = new Map<string, DeviceTokenRecord>();
  const pins = new Map<string, PinRecord>();
  const factors = new Map<string, TotpFactorRecord>();
  const recoveryCodes = new Map<string, RecoveryCodeRecord[]>();
  let recoveryCodeSeq = 0;
  const newRecoveryCodes = (hashes: readonly string[]) =>
    hashes.map((hash) => {
      recoveryCodeSeq += 1;
      return { id: String(recoveryCodeSeq), hash };
    });
  return {
    getTotpFactor: (userId) => {
      const found = factors.get(userId);
      return Promise.resolve(found ? copyFactor(found) : null);
    },
    putPendingTotpFactor: (factor) => {
      if (factors.get(factor.userId)?.status === 'ACTIVE') return Promise.resolve(false);
      factors.set(factor.userId, copyFactor({ ...factor, status: 'PENDING' }));
      return Promise.resolve(true);
    },
    activateTotpFactor: (userId, { at, step, recoveryCodeHashes }) => {
      const found = factors.get(userId);
      if (found?.status !== 'PENDING') return Promise.resolve(false);
      factors.set(userId, {
        ...found,
        status: 'ACTIVE',
        lastUsedStep: step,
        confirmedAt: new Date(at),
      });
      recoveryCodes.set(userId, newRecoveryCodes(recoveryCodeHashes));
      return Promise.resolve(true);
    },
    deleteTotpFactor: (userId) => {
      factors.delete(userId);
      recoveryCodes.delete(userId);
      return Promise.resolve();
    },
    useTotpStep: (userId, step) => {
      const found = factors.get(userId);
      if (found?.status !== 'ACTIVE' || step <= found.lastUsedStep) return Promise.resolve(false);
      found.lastUsedStep = step;
      return Promise.resolve(true);
    },
    listRecoveryCodes: (userId) =>
      Promise.resolve((recoveryCodes.get(userId) ?? []).map((code) => ({ ...code }))),
    useRecoveryCode: (userId, id) => {
      const codes = recoveryCodes.get(userId) ?? [];
      const index = codes.findIndex((code) => code.id === id);
      if (index < 0) return Promise.resolve(false);
      codes.splice(index, 1);
      return Promise.resolve(true);
    },
    replaceRecoveryCodes: (userId, hashes) => {
      recoveryCodes.set(userId, newRecoveryCodes(hashes));
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
    deleteExpiredDeviceTokens: (now) => {
      let deleted = 0;
      for (const [hash, token] of deviceTokens) {
        if (token.expiresAt < now && deviceTokens.delete(hash)) deleted += 1;
      }
      return Promise.resolve(deleted);
    },
    reset: () => {
      devices.clear();
      deviceTokens.clear();
      pins.clear();
      factors.clear();
      recoveryCodes.clear();
      return Promise.resolve();
    },
  };
}

function createMemorySessionStore(): SessionStore {
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
    listActiveSessions: (userId, at) =>
      Promise.resolve(
        [...sessions.values()]
          .filter((s) => s.userId === userId && !s.revokedAt && s.expiresAt > at)
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
          .map(copySession),
      ),
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
    stepUpSession: (id, at) => {
      const found = sessions.get(id);
      if (found) found.steppedUpAt = new Date(at);
      return Promise.resolve();
    },
    putRefreshToken: (hash, token) => {
      refreshTokens.set(hash, copyRefresh(token));
      return Promise.resolve();
    },
    useRefreshToken: (hash, at) => {
      const found = refreshTokens.get(hash);
      if (!found) return Promise.resolve(null);
      const revokedAt = sessions.get(found.sessionId)?.revokedAt;
      const before = {
        ...copyRefresh(found),
        sessionRevokedAt: revokedAt ? new Date(revokedAt) : null,
      };
      found.usedAt ??= new Date(at);
      return Promise.resolve(before);
    },
    deleteExpiredSessions: (now, sessionsBefore) => {
      let tokensDeleted = 0;
      for (const [hash, token] of refreshTokens) {
        if (token.expiresAt < now && refreshTokens.delete(hash)) tokensDeleted += 1;
      }
      const gone = new Set<string>();
      for (const [id, found] of sessions) {
        if (found.expiresAt < sessionsBefore && sessions.delete(id)) gone.add(id);
      }
      // As the foreign key's ON DELETE CASCADE does in Postgres.
      for (const [hash, token] of refreshTokens) {
        if (gone.has(token.sessionId)) refreshTokens.delete(hash);
      }
      return Promise.resolve({ refreshTokens: tokensDeleted, sessions: gone.size });
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
