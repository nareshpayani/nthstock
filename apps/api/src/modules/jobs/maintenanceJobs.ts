import { istDateKey } from '@nthstock/utils';
import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import type { AuthRepo } from '../auth/index.js';
import type { JobResult } from './definitions.js';

export type MaintenanceJobDeps = {
  /** Null on `DB_DRIVER=memory`, where there are no partitions to make. */
  database: Database | null;
  auth: Pick<AuthRepo, 'deleteExpired'>;
};

/** Days of order partitions kept ready ahead, from the IST date of the run (spec §4.3, §9). */
export const ORDER_PARTITION_DAYS = 14;

/** Creating up to 28 tables can wait on a lock behind a long query; the default 2 s is too short. */
const ORDER_PARTITIONS_TIMEOUT_MS = 30_000;

/**
 * 00:30 (T-210): makes sure `orders` and `order_events` have a partition for each of the next 14
 * IST days. `ensure_order_partitions` is SECURITY DEFINER and granted to the app role, which has
 * no DDL of its own; it skips days that already have one, so a rerun creates nothing.
 */
export async function runOrderPartitions(at: Date, deps: MaintenanceJobDeps): Promise<JobResult> {
  const { database } = deps;
  if (!database) return { partitions: 0 };
  const created = await database.transaction(
    async (tx) => {
      const result = await tx.execute<{ created: number }>(
        sql`select ensure_order_partitions(${istDateKey(at)}::date, ${ORDER_PARTITION_DAYS}) as created`,
      );
      return result.rows[0]?.created ?? 0;
    },
    { statementTimeoutMs: ORDER_PARTITIONS_TIMEOUT_MS },
  );
  return { partitions: created };
}

/**
 * 03:00 (T-210): deletes expired refresh and trusted-device tokens, and sessions expired over 30
 * days. Only the counts are returned; the rows' hashes and ids never leave the repo.
 */
export async function runTokenCleanup(at: Date, deps: MaintenanceJobDeps): Promise<JobResult> {
  return deps.auth.deleteExpired(at);
}
