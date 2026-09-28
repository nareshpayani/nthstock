import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { SESSION_REVOKED_REASONS } from '../../modules/auth/repo.js';
import { bytea, instant, sqlList } from './columns.js';
import { users } from './users.js';

/**
 * Devices a user logged in from (T-191, spec backend-core §4.1). `trusted` is set when the user
 * sets a PIN on the device, which also issues its trusted-device token.
 */
export const devices = pgTable(
  'devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    trusted: boolean('trusted').notNull().default(false),
    createdAt: instant('created_at').notNull(),
    lastSeenAt: instant('last_seen_at').notNull(),
  },
  (table) => [index('devices_user_id_idx').on(table.userId)],
);

/**
 * Trusted-device tokens (T-191), stored by the SHA-256 of the token (never the token). One per
 * device: a new one replaces the old.
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    tokenHash: bytea('token_hash').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .unique('device_tokens_device_id_unique')
      .references(() => devices.id, { onDelete: 'cascade' }),
    expiresAt: instant('expires_at').notNull(),
  },
  (table) => [
    // Cleanup of expired tokens (T-210).
    index('device_tokens_expires_at_idx').on(table.expiresAt),
    check('device_tokens_token_hash_check', sql`octet_length(${table.tokenHash}) = 32`),
  ],
);

/**
 * PINs (T-191): the Argon2id hash (never the PIN) and the wrong-attempt count behind the lock,
 * which is only ever changed by one `UPDATE … RETURNING`, so concurrent wrong PINs count exactly.
 */
export const pins = pgTable(
  'pins',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    hash: text('hash').notNull(),
    failures: smallint('failures').notNull().default(0),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [check('pins_failures_check', sql`${table.failures} >= 0`)],
);

/**
 * Sessions (T-192, spec backend-core §4.1 and §7.2). The id is the refresh-token family.
 * `revoked_at` is the record of revocation (Redis only caches it, T-194) and always comes with its
 * reason. `last_seen_at` is written at most about once a minute; `stepped_up_at` backs step-up
 * re-authentication (T-214).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    createdAt: instant('created_at').notNull(),
    lastSeenAt: instant('last_seen_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
    steppedUpAt: instant('stepped_up_at'),
    revokedAt: instant('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    // The active sessions list (T-223) and revoking a user's sessions.
    index('sessions_user_id_live_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    // Cleanup of sessions expired over 30 days (T-210).
    index('sessions_expires_at_idx').on(table.expiresAt),
    check(
      'sessions_revoked_reason_check',
      sql`${table.revokedReason} IN (${sqlList(SESSION_REVOKED_REASONS)})`,
    ),
    check(
      'sessions_revoked_check',
      sql`(${table.revokedAt} IS NULL) = (${table.revokedReason} IS NULL)`,
    ),
  ],
);

/**
 * Refresh tokens (T-192), stored by the SHA-256 of the token. `used_at` is set when the token is
 * rotated, in the same statement that reads its old value, so exactly one of two racing refreshes
 * wins and the other is reuse.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    tokenHash: bytea('token_hash').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    expiresAt: instant('expires_at').notNull(),
    usedAt: instant('used_at'),
  },
  (table) => [
    index('refresh_tokens_session_id_idx').on(table.sessionId),
    index('refresh_tokens_expires_at_idx').on(table.expiresAt),
    check('refresh_tokens_token_hash_check', sql`octet_length(${table.tokenHash}) = 32`),
  ],
);
