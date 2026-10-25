import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { pnlSnapshots } from '../../db/schema/paper.js';
import type { PnlSnapshot, PnlSnapshotRepo } from './repo.js';

/** `excluded."column"`: the value an INSERT … ON CONFLICT DO UPDATE tried to write. */
const excluded = (column: string) => sql.raw(`excluded."${column}"`);

/** The Postgres P&L snapshots (T-209): an upsert on the primary key `(user_id, trade_date)`. */
export function createPgPnlSnapshotRepo({ database }: { database: Database }): PnlSnapshotRepo {
  return {
    async upsert(snapshot) {
      await database.db
        .insert(pnlSnapshots)
        .values(snapshot)
        .onConflictDoUpdate({
          target: [pnlSnapshots.userId, pnlSnapshots.tradeDate],
          set: {
            invested: excluded('invested'),
            currentValue: excluded('current_value'),
            dayPnl: excluded('day_pnl'),
            realisedPnl: excluded('realised_pnl'),
            totalPnl: excluded('total_pnl'),
            createdAt: excluded('created_at'),
          },
        });
    },

    async find(userId, tradeDate): Promise<PnlSnapshot | null> {
      const [row] = await database.db
        .select()
        .from(pnlSnapshots)
        .where(and(eq(pnlSnapshots.userId, userId), eq(pnlSnapshots.tradeDate, tradeDate)));
      return row ?? null;
    },

    reset: () =>
      Promise.reject(
        new Error(
          'The Postgres P&L snapshots repo does not reset: tests truncate its table as the owner ' +
            '(TestPostgres.truncate).',
        ),
      ),
  };
}
