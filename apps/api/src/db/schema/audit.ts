import { sql } from 'drizzle-orm';
import { bigserial, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from '../../modules/audit/schema.js';
import { sqlList } from './columns.js';

/**
 * The append-only audit log (T-185, spec backend-core §4.4 and §8).
 *
 * - No foreign keys: `user_id` is an opaque id, so a purged user's entries outlive them, and a
 *   failed login for an unknown mobile has none (NULL).
 * - `action` and `outcome` are checked against `AUDIT_ACTIONS` and `AUDIT_OUTCOMES`, so a new
 *   action needs a migration.
 * - Append-only is enforced by the migration after the one that creates it (T-186): the app role
 *   may only INSERT and SELECT, and a trigger rejects UPDATE and DELETE for every role.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    at: timestamp('at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    actorType: text('actor_type').notNull(),
    actorUserId: text('actor_user_id'),
    userId: text('user_id'),
    action: text('action').notNull(),
    orderId: text('order_id'),
    outcome: text('outcome').notNull(),
    requestId: text('request_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('audit_log_user_id_at_idx').on(table.userId, table.at),
    index('audit_log_action_at_idx').on(table.action, table.at),
    check('audit_log_action_check', sql`${table.action} IN (${sqlList(AUDIT_ACTIONS)})`),
    check('audit_log_outcome_check', sql`${table.outcome} IN (${sqlList(AUDIT_OUTCOMES)})`),
    // A user actor names the user; the system names nobody.
    check(
      'audit_log_actor_check',
      sql`(${table.actorType} = 'user' AND ${table.actorUserId} IS NOT NULL) OR (${table.actorType} = 'system' AND ${table.actorUserId} IS NULL)`,
    ),
    check('audit_log_detail_check', sql`jsonb_typeof(${table.detail}) = 'object'`),
  ],
);
