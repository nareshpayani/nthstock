import type { Clock } from '@nthstock/utils';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { deviceTokens, devices, pins } from '../../db/schema/auth.js';
import {
  composeAuthRepo,
  createMemorySessionStore,
  type AuthRepo,
  type DeviceRecord,
  type DeviceStore,
  type OtpStore,
} from './repo.js';

type DeviceRow = typeof devices.$inferSelect;

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
export function createPgDeviceStore({
  database,
  clock,
}: {
  database: Database;
  clock: Clock;
}): DeviceStore {
  const { db } = database;
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

    reset: refuseReset('device store'),
  };
}

export type PgAuthRepoOptions = {
  database: Database;
  clock: Clock;
  /** Where OTP challenges and the resend throttle live (Redis in apps/api, T-193). */
  otp: OtpStore;
};

/**
 * AuthRepo for `DB_DRIVER=postgres`: devices, device tokens and PINs in Postgres (T-191); OTPs in
 * the given store; sessions and refresh tokens in memory until T-192.
 */
export function createPgAuthRepo({ database, clock, otp }: PgAuthRepoOptions): AuthRepo {
  return composeAuthRepo({
    otp,
    devices: createPgDeviceStore({ database, clock }),
    sessions: createMemorySessionStore(),
  });
}
