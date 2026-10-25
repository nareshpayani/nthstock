import { fixedClock } from '@nthstock/utils';
import { sql } from 'drizzle-orm';
import type { Database, Tx } from '../../db/client.js';
import { createPgAuditRepo } from '../audit/index.js';
import type { JobResult } from './definitions.js';

export type AccountPurgeDeps = {
  /**
   * The database as the `nthstock_purge` role (`PURGE_DATABASE_URL`), the only role that may delete
   * ledger rows. Null on `DB_DRIVER=memory`, where nothing outlives the process anyway.
   */
  purgeDatabase: Database | null;
};

/**
 * Every table that holds a user's rows, children before parents. `audit_log` is not here: its
 * entries outlive the user (spec backend-core §8). Rows without a `user_id` of their own
 * (`device_tokens`, `refresh_tokens`, `watchlist_items`) go with their parent's ON DELETE CASCADE.
 * `accountPurge.integration.test.ts` checks this list against the live catalog, so a new table
 * with a `user_id` fails the test until it is added.
 */
export const PURGED_TABLES = [
  'notification_outbox',
  'notifications',
  'price_alerts',
  'trailing_stops',
  'order_events',
  'orders',
  'ledger_entries',
  'holding_sales',
  'holdings',
  'positions',
  'pnl_snapshots',
  'paper_accounts',
  'watchlists',
  'totp_recovery_codes',
  'totp_factors',
  'pins',
  'sessions',
  'devices',
  'consents',
] as const;

/** Accounts read per batch; each is still purged in its own transaction. */
const PURGE_BATCH = 100;
/** One user's orders span many daily partitions: allow longer than the default 2 s. */
const PURGE_TIMEOUT_MS = 30_000;

/** Purges one account in one transaction; false when another run purged it first. */
async function purgeAccount(tx: Tx, userId: string, at: Date): Promise<boolean> {
  // FOR UPDATE, so two overlapping runs purge it once and no insert that names the user (a
  // foreign key takes KEY SHARE on the row) can commit between the deletes and the tombstone.
  const locked = await tx.execute(
    sql`select id from users
         where id = ${userId} and deleted_at is not null and purged_at is null
           and purge_after <= ${at}
         for update`,
  );
  if (locked.rows.length === 0) return false;
  for (const table of PURGED_TABLES) {
    await tx.execute(sql`delete from ${sql.identifier(table)} where user_id = ${userId}`);
  }
  // The tombstone: only the id, KYC status, flags and timestamps stay. purged_at is set last.
  await tx.execute(
    sql`update users
           set mobile_enc = null, mobile_hash = null, mobile_last4 = null, name_enc = null,
               email_enc = null, pin_set = false, totp_enabled = false, updated_at = ${at},
               purged_at = ${at}
         where id = ${userId}`,
  );
  return true;
}

/**
 * 02:00 (T-230, spec backend-core §10): purges every account whose `purge_after` has passed. Each
 * account is one transaction, as `nthstock_purge`: its rows go from every table but `audit_log`,
 * its `users` row becomes a tombstone without PII, and an `ACCOUNT_PURGED` entry is written. The
 * mobile can then sign up again as a new user. A rerun finds nothing left to purge.
 *
 * One account that fails (a timeout, a missing grant) rolls back alone: the run carries on with
 * the rest, then throws, so BullMQ retries and the failure is logged. Accounts are read by keyset
 * on `(purge_after, id)`, so a failed or already-purged account is never read twice in one run.
 */
export async function runAccountPurge(
  at: Date,
  deps: AccountPurgeDeps,
  batch = PURGE_BATCH,
): Promise<JobResult> {
  const { purgeDatabase: database } = deps;
  if (!database) return { accounts: 0 };
  const audit = createPgAuditRepo({ database, clock: fixedClock(at) });
  let accounts = 0;
  let failed = 0;
  let firstError: unknown = null;
  let after: { purgeAfter: Date; id: string } | null = null;
  for (;;) {
    const cursor: ReturnType<typeof sql> = after
      ? sql`and (purge_after, id) > (${after.purgeAfter}, ${after.id})`
      : sql``;
    const due = await database.db.execute<{ id: string; purge_after: Date | string }>(
      sql`select id, purge_after from users
           where deleted_at is not null and purged_at is null and purge_after <= ${at} ${cursor}
           order by purge_after, id
           limit ${batch}`,
    );
    for (const { id } of due.rows) {
      try {
        const purged = await database.transaction(
          async (tx) => {
            if (!(await purgeAccount(tx, id, at))) return false;
            await audit.appendMany(
              [
                {
                  actor: { type: 'system' },
                  userId: id,
                  action: 'ACCOUNT_PURGED',
                  orderId: null,
                  outcome: 'OK',
                  detail: {},
                },
              ],
              tx,
            );
            return true;
          },
          { statementTimeoutMs: PURGE_TIMEOUT_MS },
        );
        if (purged) accounts += 1;
      } catch (error) {
        failed += 1;
        firstError ??= error;
      }
    }
    const last = due.rows.at(-1);
    if (!last || due.rows.length < batch) break;
    after = { purgeAfter: new Date(last.purge_after), id: last.id };
  }
  if (failed > 0) {
    throw new Error(
      `account purge failed for ${String(failed)} account(s); ${String(accounts)} purged`,
      {
        cause: firstError,
      },
    );
  }
  return { accounts };
}
