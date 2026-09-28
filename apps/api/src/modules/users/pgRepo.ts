import { randomUUID } from 'node:crypto';
import type { KycStatus } from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { mobileHash, type PiiCrypto } from '../../db/crypto.js';
import { users } from '../../db/schema/users.js';
import { isUniqueViolation } from '../../db/errors.js';
import { DuplicateMobileError, type UserRecord, type UsersRepo } from './repo.js';

type UserRow = typeof users.$inferSelect;

/** The AES-GCM context (additional data) of each encrypted column. */
export const USER_PII_CONTEXT = {
  mobile: 'users.mobile_enc',
  name: 'users.name_enc',
  email: 'users.email_enc',
} as const;

export type PgUsersRepoOptions = {
  database: Database;
  clock: Clock;
  pii: PiiCrypto;
  /** Id generator for new users; default `usr_<uuid>`. */
  newId?: () => string;
};

/**
 * Users in Postgres (T-190, spec backend-core §4.1 and §5.2). Encrypts the mobile, name and email
 * on the way in and decrypts them on the way out, so no plaintext PII reaches the table; finds a
 * mobile by its blind index. Deleted users (`deleted_at`) are invisible to `findByMobile`, and a
 * purged tombstone to every read.
 */
export function createPgUsersRepo({
  database,
  clock,
  pii,
  newId = () => `usr_${randomUUID()}`,
}: PgUsersRepoOptions): UsersRepo {
  const { db } = database;
  const seal = (value: string | null, context: string) =>
    value === null ? null : pii.encrypt(value, context);
  const open = (value: Buffer | null, context: string) =>
    value === null ? null : pii.decrypt(value, context);

  function toRecord(row: UserRow): UserRecord | null {
    if (row.purgedAt !== null || row.mobileEnc === null) return null;
    return {
      id: row.id,
      mobile: pii.decrypt(row.mobileEnc, USER_PII_CONTEXT.mobile),
      name: open(row.nameEnc, USER_PII_CONTEXT.name),
      email: open(row.emailEnc, USER_PII_CONTEXT.email),
      // The table's CHECK holds this to KYC_STATUSES.
      kycStatus: row.kycStatus as KycStatus,
      pinSet: row.pinSet,
      totpEnabled: row.totpEnabled,
      createdAt: row.createdAt,
    };
  }

  const first = (rows: UserRow[]) => (rows[0] ? toRecord(rows[0]) : null);

  const mobileColumns = (mobile: string) => ({
    mobileEnc: pii.encrypt(mobile, USER_PII_CONTEXT.mobile),
    mobileHash: mobileHash(pii, mobile),
    mobileLast4: mobile.slice(-4),
  });

  return {
    async findById(id) {
      return first(await db.select().from(users).where(eq(users.id, id)));
    },

    async findByMobile(mobile) {
      return first(
        await db
          .select()
          .from(users)
          .where(and(eq(users.mobileHash, mobileHash(pii, mobile)), isNull(users.deletedAt))),
      );
    },

    async create(user) {
      const now = clock.now();
      try {
        const rows = await db
          .insert(users)
          .values({
            id: newId(),
            ...mobileColumns(user.mobile),
            nameEnc: seal(user.name ?? null, USER_PII_CONTEXT.name),
            emailEnc: seal(user.email ?? null, USER_PII_CONTEXT.email),
            kycStatus: 'NOT_STARTED',
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const created = first(rows);
        if (!created) throw new Error('create returned no user');
        return created;
      } catch (error) {
        if (isUniqueViolation(error, 'users_mobile_hash_live_idx')) {
          throw new DuplicateMobileError();
        }
        throw error;
      }
    },

    async update(id, patch) {
      const set: Partial<typeof users.$inferInsert> = { updatedAt: clock.now() };
      if (patch.name !== undefined) set.nameEnc = seal(patch.name, USER_PII_CONTEXT.name);
      if (patch.email !== undefined) set.emailEnc = seal(patch.email, USER_PII_CONTEXT.email);
      if (patch.kycStatus !== undefined) set.kycStatus = patch.kycStatus;
      if (patch.pinSet !== undefined) set.pinSet = patch.pinSet;
      if (patch.totpEnabled !== undefined) set.totpEnabled = patch.totpEnabled;
      return first(
        await db
          .update(users)
          .set(set)
          .where(and(eq(users.id, id), isNull(users.purgedAt)))
          .returning(),
      );
    },

    async ensureSeeded(user) {
      // No conflict target: an existing id or a live user with the mobile both skip the insert.
      const rows = await db
        .insert(users)
        .values({
          id: user.id,
          ...mobileColumns(user.mobile),
          nameEnc: seal(user.name, USER_PII_CONTEXT.name),
          emailEnc: seal(user.email, USER_PII_CONTEXT.email),
          kycStatus: user.kycStatus,
          pinSet: user.pinSet,
          totpEnabled: user.totpEnabled,
          createdAt: user.createdAt,
          updatedAt: user.createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      return rows.length > 0;
    },

    reset: () =>
      Promise.reject(
        new Error(
          'The Postgres users repo does not reset: tests truncate its tables as the owner ' +
            '(TestPostgres.truncate).',
        ),
      ),
  };
}
