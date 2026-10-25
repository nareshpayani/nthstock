import type { Pool } from 'pg';
import type { MatcherLog } from './matcher.js';
import type { LiveOrder, LiveOrderSource, LiveStop } from './reconcile.js';

/** Long enough for a shard's live orders, short enough that a stuck read cannot pile up rounds. */
const STATEMENT_TIMEOUT_MS = 5_000;
/** Client-side bounds: the server's statement_timeout does not help on a half-open network. */
export const CONNECTION_TIMEOUT_MS = 5_000;
export const QUERY_TIMEOUT_MS = STATEMENT_TIMEOUT_MS + 2_000;

type LiveOrderRow = {
  id: string;
  user_id: string;
  token: number;
  side: 'BUY' | 'SELL';
  price: string;
  shard: number | null;
  version: string;
};

type LiveStopRow = {
  id: string;
  user_id: string;
  token: number;
  status: 'ARMED' | 'TRAILING';
  direction: 'LONG' | 'SHORT';
  trail_unit: 'AMOUNT' | 'PERCENT';
  trail_amount: string | null;
  trail_basis_points: number | null;
  activation_price: string | null;
  watermark_price: string | null;
  stop_price: string | null;
  version: string;
};

const paiseOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value);

/** The row's trail: the CHECK holds exactly one value to its unit, so a missing one is damage. */
function trailOf(row: LiveStopRow): LiveStop['state']['trail'] | null {
  if (row.trail_unit === 'PERCENT' && row.trail_basis_points !== null) {
    return { unit: 'PERCENT', basisPoints: row.trail_basis_points };
  }
  if (row.trail_unit === 'AMOUNT' && row.trail_amount !== null) {
    return { unit: 'AMOUNT', amount: Number(row.trail_amount) };
  }
  return null;
}

/**
 * Reads a shard's live orders from Postgres (NSTOCK-0366) in one REPEATABLE READ, read-only
 * transaction, so the orders, the active trailing stops and the account versions are one snapshot.
 * The orders query is served by the partial index `orders_shard_live_idx` (migration 0016). The
 * stops query reads the ARMED and TRAILING rows, the ones `STOP_ADD` puts on a book, of every
 * shard: `trailing_stops` has no shard column and `shardOf` is not plain SQL, so the reconcile
 * keeps those on its shard by token. Prices and versions are bigint columns, which `pg` returns as
 * strings. A damaged stop row (no trail value for its unit) is logged and left out, so one bad row
 * cannot stop every round (NSTOCK-0388); the reconcile then takes that stop off a book, which could
 * not step it anyway.
 */
export function createPgLiveOrderSource(
  pool: Pick<Pool, 'connect'>,
  log?: Pick<MatcherLog, 'warn'>,
): LiveOrderSource {
  return {
    async read(shard, userIds) {
      const client = await pool.connect();
      let failure: Error | undefined;
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
        const stops = await client.query<LiveStopRow>(
          `SELECT s.id, s.user_id, s.token, s.status, s.direction, s.trail_unit, s.trail_amount,
                  s.trail_basis_points, s.activation_price, s.watermark_price, s.stop_price,
                  a.version
             FROM trailing_stops s
             JOIN paper_accounts a ON a.user_id = s.user_id
            WHERE s.status IN ('ARMED', 'TRAILING')`,
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
        const liveStops: LiveStop[] = [];
        for (const row of stops.rows) {
          const trail = trailOf(row);
          if (!trail) {
            log?.warn('Skipped a damaged trailing stop row', {
              stopId: row.id,
              userId: row.user_id,
              trailUnit: row.trail_unit,
            });
            continue;
          }
          liveStops.push({
            stopId: row.id,
            userId: row.user_id,
            token: row.token,
            version: Number(row.version),
            state: {
              status: row.status,
              direction: row.direction,
              trail,
              activationPrice: paiseOrNull(row.activation_price),
              watermarkPrice: paiseOrNull(row.watermark_price),
              stopPrice: paiseOrNull(row.stop_price),
            },
          });
        }
        return {
          orders,
          stops: liveStops,
          versions: new Map(versions.rows.map((row) => [row.user_id, Number(row.version)])),
        };
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        // Releasing with the error discards the connection, so a dead one is not reused.
        client.release(failure);
      }
    },
  };
}
