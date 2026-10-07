import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { bytea, instant, sqlList } from './columns.js';

/**
 * `KycStatus` from packages/contracts, repeated because drizzle-kit cannot load the contracts
 * package (ESM only); `db/schemaEnums.test.ts` keeps the two equal.
 */
export const KYC_STATUSES = ['NOT_STARTED', 'PENDING', 'VERIFIED'] as const;

/** What a user consented to (spec backend-core §4.1, §10). */
export const CONSENT_PURPOSES = ['TERMS_AND_PRIVACY'] as const;

/**
 * Users (T-190, spec backend-core §4.1). No plaintext PII: the mobile, name and email are
 * AES-256-GCM ciphertexts (`db/crypto.ts`); a mobile is found by `mobile_hash`, its HMAC blind
 * index, and masked from `mobile_last4` without decrypting.
 *
 * - `mobile_hash` is unique among users that are not deleted, so a deleted user's mobile can sign
 *   up again once they are gone.
 * - The PII columns are nullable only for a purged tombstone (`purged_at` set): the purge job
 *   nulls them and keeps the row, which audit rows still name.
 * - `pin_set` and `totp_enabled` back `User.pinSet` and `User.totpEnabled` on the one row the
 *   session reads.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    mobileEnc: bytea('mobile_enc'),
    mobileHash: bytea('mobile_hash'),
    mobileLast4: char('mobile_last4', { length: 4 }),
    nameEnc: bytea('name_enc'),
    emailEnc: bytea('email_enc'),
    kycStatus: text('kyc_status').notNull().default('NOT_STARTED'),
    pinSet: boolean('pin_set').notNull().default(false),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
    deletedAt: instant('deleted_at'),
    purgeAfter: instant('purge_after'),
    purgedAt: instant('purged_at'),
  },
  (table) => [
    uniqueIndex('users_mobile_hash_live_idx')
      .on(table.mobileHash)
      .where(sql`${table.deletedAt} IS NULL`),
    index('users_purge_after_idx')
      .on(table.purgeAfter)
      .where(sql`${table.purgedAt} IS NULL`),
    check('users_kyc_status_check', sql`${table.kycStatus} IN (${sqlList(KYC_STATUSES)})`),
    // Every user but a purged tombstone has its mobile.
    check(
      'users_mobile_check',
      sql`${table.purgedAt} IS NOT NULL OR (${table.mobileEnc} IS NOT NULL AND ${table.mobileHash} IS NOT NULL AND ${table.mobileLast4} IS NOT NULL)`,
    ),
    check('users_mobile_last4_check', sql`${table.mobileLast4} ~ '^[0-9]{4}$'`),
    check('users_mobile_hash_check', sql`octet_length(${table.mobileHash}) = 32`),
  ],
);

/**
 * Consents (T-190, spec backend-core §10): one row per grant, written with the user at sign-up
 * (T-228). Withdrawal short of deletion is later work, so `withdrawn_at` stays NULL this phase.
 */
export const consents = pgTable(
  'consents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    policyVersion: text('policy_version').notNull(),
    grantedAt: instant('granted_at').notNull(),
    withdrawnAt: instant('withdrawn_at'),
  },
  (table) => [
    index('consents_user_id_purpose_idx').on(table.userId, table.purpose),
    check('consents_purpose_check', sql`${table.purpose} IN (${sqlList(CONSENT_PURPOSES)})`),
  ],
);
