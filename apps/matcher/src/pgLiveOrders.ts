import type { Pool } from 'pg';
import type { LiveOrder, LiveOrderSource } from './reconcile.js';

/** Long enough for a shard's live orders, short enough that a stuck read cannot pile up rounds. */
const STATEMENT_TIMEOUT_MS = 5_000;

type LiveOrderRow = {
  id: string;
  user_id: string;
  token: number;
  side: 'BUY' | 'SELL';
  price: string;
  shard: number | null;
  version: string;
};

/**
 * Reads a shard's live orders from Postgres (NSTOCK-0366) in one REPEATABLE READ, read-only
 * transaction, so the orders and the account versions are one snapshot. The orders query is
 * served by the partial index `orders_shard_live_idx` (migration 0016). Prices and versions are
 * bigint columns, which `pg` returns as strings.
 */
export function createPgLiveOrderSource(pool: Pick<Pool, 'connect'>): LiveOrderSource {
  return {
    async read(shard, userIds) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${String(STATEMENT_TIMEOUT_MS)}`);
        const live = await client.query<LiveOrderRow>(
          `SELECT o.id, o.user_id, o.token, o.side, o.price, o.shard, a.version
             FROM orders o
             JOIN paper_accounts a ON a.user_id = o.user_id
            WHERE o.status = 'OPEN' AND o.type = 'LIMIT' AND o.price IS NOT NULL
              AND (o.shard = $1 OR o.shard IS NULL)`,
          [shard],
        );
        const versions = await client.query<{ user_id: string; version: string }>(
          'SELECT user_id, version FROM paper_accounts WHERE user_id = ANY($1::text[])',
          [userIds],
        );
        await client.query('COMMIT');
        const orders: LiveOrder[] = live.rows.map((row) => ({
          orderId: row.id,
          userId: row.user_id,
          token: row.token,
          side: row.side,
          price: Number(row.price),
          shard: row.shard,
          version: Number(row.version),
        }));
        return {
          orders,
          versions: new Map(versions.rows.map((row) => [row.user_id, Number(row.version)])),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
