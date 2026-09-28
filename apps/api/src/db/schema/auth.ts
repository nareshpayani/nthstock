import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { bytea, instant } from './columns.js';
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
