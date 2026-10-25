import { base32Decode, base32Encode, type Clock } from '@nthstock/utils';
import { and, desc, eq, gt, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import type { PiiCrypto } from '../../db/crypto.js';
import {
  deviceTokens,
  devices,
  pins,
  refreshTokens,
  sessions,
  totpFactors,
  totpRecoveryCodes,
} from '../../db/schema/auth.js';
import {
  composeAuthRepo,
  type AuthRepo,
  type DeviceRecord,
  type DeviceStore,
  type OtpStore,
  type SessionRecord,
  type SessionRevokedReason,
  type SessionStore,
  type TotpFactorRecord,
} from './repo.js';

type DeviceRow = typeof devices.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

/** A SHA-256 in hex (how the services pass token hashes) as the 32 bytes the tables store. */
export function tokenHashBytes(hash: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('A token hash must be a hex SHA-256');
  return Buffer.from(hash, 'hex');
}

const refuseReset = (what: string) => () =>
  Promise.reject(
    new Error(
      `The Postgres ${what} does not reset: tests truncate its tables as the owner ` +
        '(TestPostgres.truncate).',
    ),
  );

const toDevice = (row: DeviceRow): DeviceRecord => ({
  id: row.id,
  userId: row.userId,
  label: row.label,
  trusted: row.trusted,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
});

/**
 * Devices, trusted-device tokens and PINs in Postgres (T-191, spec backend-core §4.1). The PIN
 * failure count only changes in one `UPDATE … RETURNING`, so concurrent wrong PINs each get their
 * own count and the fifth one locks.
 */
/** Rows one cleanup statement deletes at most (T-210); a session's cascade adds its tokens. */
export const CLEANUP_CHUNK = 5_000;
const CLEANUP_STATEMENT_TIMEOUT_MS = 10_000;

/** Runs a `… limit <chunk>` delete until it deletes less than a chunk; the total deleted. */
async function deleteInChunks(database: Database, chunk: number, statement: SQL): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await database.transaction(
      async (tx) => (await tx.execute(statement)).rowCount ?? 0,
      { statementTimeoutMs: CLEANUP_STATEMENT_TIMEOUT_MS },
    );
    total += deleted;
    if (deleted < chunk) return total;
  }
}

export function createPgDeviceStore({
  database,
  clock,
  pii,
  cleanupChunk = CLEANUP_CHUNK,
}: {
  database: Database;
  clock: Clock;
  /** Encrypts TOTP secrets at rest (NSTOCK-0215). */
  pii: PiiCrypto;
  /** Rows per cleanup delete (default `CLEANUP_CHUNK`). */
  cleanupChunk?: number;
}): DeviceStore {
  const { db } = database;
  // The user id binds each ciphertext to its row: a secret copied to another user fails to decrypt.
  const secretContext = (userId: string) => `totp_factors.secret:${userId}`;
  const toFactor = (row: typeof totpFactors.$inferSelect): TotpFactorRecord => ({
    userId: row.userId,
    secret: base32Decode(pii.decrypt(row.secretEnc, secretContext(row.userId))),
    // The table's CHECK holds this to TOTP_FACTOR_STATUSES.
    status: row.status as TotpFactorRecord['status'],
    lastUsedStep: row.lastUsedStep,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  });
  const insertRecoveryCodes = (
    tx: Pick<Database['db'], 'insert'>,
    userId: string,
    hashes: readonly string[],
  ) =>
    hashes.length === 0
      ? Promise.resolve()
      : tx
          .insert(totpRecoveryCodes)
          .values(hashes.map((hash) => ({ userId, hash, createdAt: clock.now() })))
          .then(() => undefined);
  const getDevice = async (id: string) => {
    const [row] = await db.select().from(devices).where(eq(devices.id, id));
    return row ? toDevice(row) : null;
  };
  return {
    async createDevice(device) {
      await db.insert(devices).values({ ...device });
    },

    getDevice,

    async updateDevice(id, patch) {
      const set: Partial<typeof devices.$inferInsert> = {};
      if (patch.trusted !== undefined) set.trusted = patch.trusted;
      if (patch.lastSeenAt !== undefined) set.lastSeenAt = patch.lastSeenAt;
      if (Object.keys(set).length === 0) return getDevice(id);
      const [row] = await db.update(devices).set(set).where(eq(devices.id, id)).returning();
      return row ? toDevice(row) : null;
    },

    async putDeviceToken(hash, token) {
      // One statement: the device's earlier token (unique device_id) is replaced, never kept.
      await db
        .insert(deviceTokens)
        .values({
          tokenHash: tokenHashBytes(hash),
          deviceId: token.deviceId,
          expiresAt: token.expiresAt,
        })
        .onConflictDoUpdate({
          target: deviceTokens.deviceId,
          set: {
            tokenHash: sql`excluded.token_hash`,
            expiresAt: sql`excluded.expires_at`,
          },
        });
    },

    async getDeviceToken(hash) {
      const [row] = await db
        .select({ deviceId: deviceTokens.deviceId, expiresAt: deviceTokens.expiresAt })
        .from(deviceTokens)
        .where(eq(deviceTokens.tokenHash, tokenHashBytes(hash)));
      return row ?? null;
    },

    async setPin(userId, hash) {
      const updatedAt = clock.now();
      await db
        .insert(pins)
        .values({ userId, hash, failures: 0, updatedAt })
        .onConflictDoUpdate({ target: pins.userId, set: { hash, failures: 0, updatedAt } });
    },

    async getPin(userId) {
      const [row] = await db
        .select({ hash: pins.hash, failures: pins.failures })
        .from(pins)
        .where(eq(pins.userId, userId));
      return row ?? null;
    },

    async recordPinFailure(userId) {
      const [row] = await db
        .update(pins)
        .set({ failures: sql`${pins.failures} + 1`, updatedAt: clock.now() })
        .where(eq(pins.userId, userId))
        .returning({ failures: pins.failures });
      return row?.failures ?? 0;
    },

    async clearPinFailures(userId) {
      await db
        .update(pins)
        .set({ failures: 0, updatedAt: clock.now() })
        .where(eq(pins.userId, userId));
    },

    async deleteExpiredDeviceTokens(now) {
      // On device_tokens_expires_at_idx. The device row stays; an expired token already fails.
      return deleteInChunks(
        database,
        cleanupChunk,
        sql`delete from device_tokens where token_hash in (select token_hash from device_tokens where expires_at < ${now} limit ${cleanupChunk})`,
      );
    },

    async getTotpFactor(userId) {
      const [row] = await db.select().from(totpFactors).where(eq(totpFactors.userId, userId));
      return row ? toFactor(row) : null;
    },

    async putPendingTotpFactor(factor) {
      // One statement: insert, or replace only a PENDING factor; an ACTIVE one stays.
      const rows = await db
        .insert(totpFactors)
        .values({
          userId: factor.userId,
          secretEnc: pii.encrypt(base32Encode(factor.secret), secretContext(factor.userId)),
          status: 'PENDING',
          lastUsedStep: factor.lastUsedStep,
          createdAt: factor.createdAt,
          confirmedAt: null,
        })
        .onConflictDoUpdate({
          target: totpFactors.userId,
          set: {
            secretEnc: sql`excluded.secret_enc`,
            lastUsedStep: sql`excluded.last_used_step`,
            createdAt: sql`excluded.created_at`,
          },
          setWhere: eq(totpFactors.status, 'PENDING'),
        })
        .returning({ userId: totpFactors.userId });
      return rows.length === 1;
    },

    async activateTotpFactor(userId, { at, step, recoveryCodeHashes }) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(totpFactors)
          .set({ status: 'ACTIVE', lastUsedStep: step, confirmedAt: at })
          .where(and(eq(totpFactors.userId, userId), eq(totpFactors.status, 'PENDING')))
          .returning({ userId: totpFactors.userId });
        if (rows.length === 0) return false;
        await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
        await insertRecoveryCodes(tx, userId, recoveryCodeHashes);
        return true;
      });
    },

    async deleteTotpFactor(userId) {
      await db.transaction(async (tx) => {
        await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
        await tx.delete(totpFactors).where(eq(totpFactors.userId, userId));
      });
    },

    async useTotpStep(userId, step) {
      const rows = await db
        .update(totpFactors)
        .set({ lastUsedStep: step })
        .where(
          and(
            eq(totpFactors.userId, userId),
            eq(totpFactors.status, 'ACTIVE'),
            lt(totpFactors.lastUsedStep, step),
          ),
        )
        .returning({ userId: totpFactors.userId });
      return rows.length === 1;
    },

    async listRecoveryCodes(userId) {
      const rows = await db
        .select({ id: totpRecoveryCodes.id, hash: totpRecoveryCodes.hash })
        .from(totpRecoveryCodes)
        .where(eq(totpRecoveryCodes.userId, userId));
      return rows.map((row) => ({ id: String(row.id), hash: row.hash }));
    },

    async useRecoveryCode(userId, id) {
      if (!/^\d+$/.test(id)) return false;
      const rows = await db
        .delete(totpRecoveryCodes)
        .where(and(eq(totpRecoveryCodes.id, Number(id)), eq(totpRecoveryCodes.userId, userId)))
        .returning({ id: totpRecoveryCodes.id });
      return rows.length === 1;
    },

    async replaceRecoveryCodes(userId, hashes) {
      await db.transaction(async (tx) => {
        await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
        await insertRecoveryCodes(tx, userId, hashes);
      });
    },

    reset: refuseReset('device store'),
  };
}

const toSession = (row: SessionRow): SessionRecord => ({
  id: row.id,
  userId: row.userId,
  deviceId: row.deviceId,
  csrfToken: row.csrfToken,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  expiresAt: row.expiresAt,
  steppedUpAt: row.steppedUpAt,
  revokedAt: row.revokedAt,
  // The table's CHECK holds this to SESSION_REVOKED_REASONS.
  revokedReason: row.revokedReason as SessionRevokedReason | null,
});

/**
 * Sessions and refresh tokens in Postgres (T-192, spec backend-core §4.1, §5.2 and §7.1).
 * `useRefreshToken` is one statement that locks the token row, sets `used_at` if it is unset, and
 * returns the value it had before, so of two concurrent uses exactly one sees it unused.
 */
export function createPgSessionStore({
  database,
  cleanupChunk = CLEANUP_CHUNK,
}: {
  database: Database;
  cleanupChunk?: number;
}): SessionStore {
  const { db } = database;
  return {
    async createSession(session) {
      await db.insert(sessions).values({
        id: session.id,
        userId: session.userId,
        deviceId: session.deviceId,
        csrfToken: session.csrfToken,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        steppedUpAt: session.steppedUpAt,
        revokedAt: session.revokedAt,
        revokedReason: session.revokedReason,
      });
    },

    async getSession(id) {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      return row ? toSession(row) : null;
    },

    async listActiveSessions(userId, at) {
      const rows = await db
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, at)),
        )
        .orderBy(desc(sessions.lastSeenAt));
      return rows.map(toSession);
    },

    async revokeSession(id, at, reason) {
      // A revoked session keeps its first time and reason.
      await db
        .update(sessions)
        .set({ revokedAt: at, revokedReason: reason })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
    },

    async touchSession(id, at, staleBefore) {
      await db
        .update(sessions)
        .set({ lastSeenAt: at })
        .where(and(eq(sessions.id, id), lte(sessions.lastSeenAt, staleBefore)));
    },

    async stepUpSession(id, at) {
      await db.update(sessions).set({ steppedUpAt: at }).where(eq(sessions.id, id));
    },

    async putRefreshToken(hash, token) {
      await db.insert(refreshTokens).values({
        tokenHash: tokenHashBytes(hash),
        sessionId: token.sessionId,
        expiresAt: token.expiresAt,
        usedAt: token.usedAt,
      });
    },

    async useRefreshToken(hash, at) {
      // UPDATE … FROM (SELECT … FOR UPDATE) RETURNING the old used_at: the second of two racing
      // calls waits for the first's row lock, then reads the used_at the first one set.
      const before = db
        .select({
          tokenHash: refreshTokens.tokenHash,
          usedAt: refreshTokens.usedAt,
          sessionRevokedAt: sessions.revokedAt,
        })
        .from(refreshTokens)
        .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
        .where(eq(refreshTokens.tokenHash, tokenHashBytes(hash)))
        .for('update', { of: refreshTokens })
        .as('before');
      const [row] = await db
        .update(refreshTokens)
        .set({ usedAt: sql`coalesce(${refreshTokens.usedAt}, ${at.toISOString()}::timestamptz)` })
        .from(before)
        .where(eq(refreshTokens.tokenHash, before.tokenHash))
        .returning({
          sessionId: refreshTokens.sessionId,
          expiresAt: refreshTokens.expiresAt,
          usedAt: before.usedAt,
          sessionRevokedAt: before.sessionRevokedAt,
        });
      return row ?? null;
    },

    async deleteExpiredSessions(now, sessionsBefore) {
      // Two statements on the expires_at indexes, each a pure delete, so a rerun finds nothing.
      // Deleting a session cascades to the refresh tokens still in its family.
      // Both run in chunks, each its own short transaction, so a backlog (the first run, or after
      // an outage) never holds locks or a connection for long.
      const tokens = await deleteInChunks(
        database,
        cleanupChunk,
        sql`delete from refresh_tokens where token_hash in (select token_hash from refresh_tokens where expires_at < ${now} limit ${cleanupChunk})`,
      );
      const gone = await deleteInChunks(
        database,
        cleanupChunk,
        sql`delete from sessions where id in (select id from sessions where expires_at < ${sessionsBefore} limit ${cleanupChunk})`,
      );
      return { refreshTokens: tokens, sessions: gone };
    },

    reset: refuseReset('session store'),
  };
}

export type PgAuthRepoOptions = {
  database: Database;
  clock: Clock;
  /** Encrypts TOTP secrets at rest. */
  pii: PiiCrypto;
  /** Where OTP challenges and the resend throttle live (Redis in apps/api, T-193). */
  otp: OtpStore;
  /** Rows per cleanup delete (default `CLEANUP_CHUNK`); tests use a small one. */
  cleanupChunk?: number;
};

/**
 * AuthRepo for `DB_DRIVER=postgres`: devices, device tokens and PINs (T-191) and sessions and
 * refresh tokens (T-192) in Postgres; OTPs in the given store.
 */
export function createPgAuthRepo({
  database,
  clock,
  pii,
  otp,
  cleanupChunk = CLEANUP_CHUNK,
}: PgAuthRepoOptions): AuthRepo {
  return composeAuthRepo({
    otp,
    devices: createPgDeviceStore({ database, clock, pii, cleanupChunk }),
    sessions: createPgSessionStore({ database, cleanupChunk }),
  });
}
