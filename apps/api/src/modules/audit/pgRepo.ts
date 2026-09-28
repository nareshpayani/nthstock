import { asc, eq } from 'drizzle-orm';
import type { Clock } from '@nthstock/utils';
import type { Database } from '../../db/client.js';
import { auditLog } from '../../db/schema/audit.js';
import { assertAuditEntriesAllowed, storedDetail, type AuditRepo } from './repo.js';
import type { AuditAction, AuditActor, AuditOutcome, AuditRecord } from './schema.js';

type AuditRow = typeof auditLog.$inferSelect;

function toRecord(row: AuditRow): AuditRecord {
  const actor: AuditActor =
    row.actorType === 'user' && row.actorUserId !== null
      ? { type: 'user', userId: row.actorUserId }
      : { type: 'system' };
  return Object.freeze({
    id: row.id.toString(),
    at: row.at,
    actor: Object.freeze(actor),
    userId: row.userId,
    // The table's CHECK constraints hold these to the code's lists.
    action: row.action as AuditAction,
    orderId: row.orderId,
    outcome: row.outcome as AuditOutcome,
    requestId: row.requestId,
    detail: storedDetail(row.detail),
  });
}

/**
 * The audit log in Postgres (T-187): plain INSERTs into `audit_log`, which the app role can only
 * INSERT into and SELECT from (T-186). `at` is the injected clock's time, like the memory log, so
 * tests and the E2E test clock see the time they set.
 */
export function createPgAuditRepo({
  database,
  clock,
}: {
  database: Database;
  clock: Clock;
}): AuditRepo {
  const repo: AuditRepo = {
    async append(entry) {
      const [record] = await repo.appendMany([entry]);
      if (!record) throw new Error('append wrote nothing');
      return record;
    },

    async appendMany(entries, tx) {
      assertAuditEntriesAllowed(entries);
      if (entries.length === 0) return [];
      const at = clock.now();
      // One multi-row INSERT: all or nothing, and ids in the order given.
      const rows = await (tx ?? database.db)
        .insert(auditLog)
        .values(
          entries.map((entry) => ({
            at,
            actorType: entry.actor.type,
            actorUserId: entry.actor.type === 'user' ? entry.actor.userId : null,
            userId: entry.userId,
            action: entry.action,
            orderId: entry.orderId,
            outcome: entry.outcome,
            requestId: entry.requestId ?? null,
            detail: { ...entry.detail },
          })),
        )
        .returning();
      return rows.toSorted((a, b) => (a.id < b.id ? -1 : 1)).map(toRecord);
    },

    async list(userId) {
      const query = database.db.select().from(auditLog);
      const rows = await (userId === undefined
        ? query.orderBy(asc(auditLog.id))
        : query.where(eq(auditLog.userId, userId)).orderBy(asc(auditLog.id)));
      return rows.map(toRecord);
    },

    reset: () =>
      Promise.reject(
        new Error(
          'The Postgres audit log is append-only: nthstock_app cannot delete from it. Tests ' +
            'truncate it as the owner (TestPostgres.truncate).',
        ),
      ),
  };
  return repo;
}
