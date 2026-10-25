import { randomUUID } from 'node:crypto';
import type { KycStatus } from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { mobileHash, type PiiCrypto } from '../../db/crypto.js';
import { consents, users } from '../../db/schema/users.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  DuplicateMobileError,
  type ConsentRecord,
  type UserRecord,
  type UsersRepo,
} from './repo.js';

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
      return first(
        await db
          .select()
          .from(users)
          .where(and(eq(users.id, id), isNull(users.deletedAt))),
      );
    },

    async findByMobile(mobile) {
      return first(
        await db
          .select()
          .from(users)
          .where(and(eq(users.mobileHash, mobileHash(pii, mobile)), isNull(users.deletedAt))),
      );
    },

    async create(user, consent) {
      const now = clock.now();
      try {
        // The user and its consent in one transaction: neither exists without the other.
        return await db.transaction(async (tx) => {
          const rows = await tx
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
          if (consent) {
            await tx.insert(consents).values({
              userId: created.id,
              purpose: consent.purpose,
              policyVersion: consent.policyVersion,
              grantedAt: now,
            });
          }
          return created;
        });
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

    async listConsents(userId) {
      const rows = await db
        .select()
        .from(consents)
        .where(eq(consents.userId, userId))
        .orderBy(consents.id);
      return rows.map((row): ConsentRecord => ({
        // The table's CHECK holds this to CONSENT_PURPOSES.
        purpose: row.purpose as ConsentRecord['purpose'],
        policyVersion: row.policyVersion,
        grantedAt: row.grantedAt,
        withdrawnAt: row.withdrawnAt,
      }));
    },

    async findDeletedByMobile(mobile) {
      const [row] = await db
        .select({ id: users.id, deletedAt: users.deletedAt, purgeAfter: users.purgeAfter })
        .from(users)
        .where(
          and(
            eq(users.mobileHash, mobileHash(pii, mobile)),
            isNotNull(users.deletedAt),
            isNull(users.purgedAt),
          ),
        )
        .orderBy(desc(users.deletedAt))
        .limit(1);
      if (!row?.deletedAt || !row.purgeAfter) return null;
      return { id: row.id, deletedAt: row.deletedAt, purgeAfter: row.purgeAfter };
    },

    async markDeleted(id, at, purgeAfter) {
      const rows = await db
        .update(users)
        .set({ deletedAt: at, purgeAfter, updatedAt: at })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({ id: users.id });
      return rows.length > 0;
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

    async ensureConsent(userId, consent, grantedAt) {
      // The live user's row is locked first, so two concurrent calls (two instances seeding at
      // once) serialise and the second sees the first one's consent.
      return db.transaction(async (tx) => {
        const live = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for('update');
        if (live.length === 0) return false;
        const held = await tx
          .select({ id: consents.id })
          .from(consents)
          .where(
            and(
              eq(consents.userId, userId),
              eq(consents.purpose, consent.purpose),
              eq(consents.policyVersion, consent.policyVersion),
              isNull(consents.withdrawnAt),
            ),
          )
          .limit(1);
        if (held.length > 0) return false;
        await tx.insert(consents).values({
          userId,
          purpose: consent.purpose,
          policyVersion: consent.policyVersion,
          grantedAt,
        });
        return true;
      });
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
