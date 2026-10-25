import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';

/** One stored bar: `bucket` is its open time; prices are integer paise, volume is shares. */
export type StoredBar = {
  token: number;
  bucket: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** The stored bar sizes (spec market-data-and-matching §7.1): the hypertable and its aggregates. */
export const STORED_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1d'] as const;
export type StoredInterval = (typeof STORED_INTERVALS)[number];

/** Which relation holds each bar size. Literal names only: they are interpolated into SQL. */
const RELATION: Readonly<Record<StoredInterval, string>> = {
  '1m': 'candles_1m',
  '5m': 'candles_5m',
  '15m': 'candles_15m',
  '30m': 'candles_30m',
  '1h': 'candles_1h',
  '1d': 'candles_1d',
};

/** Rows per INSERT statement: 7 parameters a row stays well under Postgres's 65,535 limit. */
export const UPSERT_CHUNK_ROWS = 5_000;

export type CandleStore = {
  /**
   * Writes bars into `candles_1m`, replacing a stored bar of the same token and minute (`ON
   * CONFLICT (token, bucket) DO UPDATE`), so writing the same minute twice leaves one row with the
   * last values. One multi-row INSERT per `UPSERT_CHUNK_ROWS` bars, in one transaction.
   */
  upsertMinuteBars(bars: readonly StoredBar[]): Promise<void>;
  /**
   * Like `upsertMinuteBars`, but a bar is skipped when its token already has any bar in the 24
   * hours from its minute, its IST session for a 09:15 bar. The seed writes its one-row daily
   * history this way, so a session that holds minute bars (from an earlier seed or the candle
   * writer, whole or partial) keeps them and never gains a whole-day row on top.
   */
  insertMinuteBarsIfAbsent(bars: readonly StoredBar[]): Promise<void>;
  /** Bars of `interval` for `token` opening in `[from, to)`, oldest first. */
  readBars(token: number, interval: StoredInterval, from: Date, to: Date): Promise<StoredBar[]>;
};

type BarRow = {
  token: number;
  /** Drizzle's node-postgres driver hands timestamps back as text. */
  bucket: string | Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

const toBar = (row: BarRow): StoredBar => ({
  token: row.token,
  bucket: new Date(row.bucket),
  open: Number(row.open),
  high: Number(row.high),
  low: Number(row.low),
  close: Number(row.close),
  volume: Number(row.volume),
});

/** The candle store on TimescaleDB (migration 0014), as the DML-only app role. */
export function createPgCandleStore({ database }: { database: Database }): CandleStore {
  /**
   * One multi-row INSERT per `UPSERT_CHUNK_ROWS` bars, all in one transaction. `insert` turns the
   * VALUES list (columns token, bucket, open, high, low, close, volume, typed) into the statement.
   */
  const writeBars = async (
    bars: readonly StoredBar[],
    insert: (values: SQL) => SQL,
  ): Promise<void> => {
    if (bars.length === 0) return;
    await database.transaction(async (tx) => {
      for (let start = 0; start < bars.length; start += UPSERT_CHUNK_ROWS) {
        const rows = bars
          .slice(start, start + UPSERT_CHUNK_ROWS)
          .map(
            (bar) =>
              sql`(${bar.token}::integer, ${bar.bucket.toISOString()}::timestamptz, ${bar.open}::bigint, ${bar.high}::bigint, ${bar.low}::bigint, ${bar.close}::bigint, ${bar.volume}::bigint)`,
          );
        await tx.execute(insert(sql`VALUES ${sql.join(rows, sql`, `)}`));
      }
    });
  };
  return {
    upsertMinuteBars: (bars) =>
      writeBars(
        bars,
        (values) => sql`
          INSERT INTO candles_1m (token, bucket, open, high, low, close, volume) ${values}
          ON CONFLICT (token, bucket) DO UPDATE SET
            open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
            close = EXCLUDED.close, volume = EXCLUDED.volume`,
      ),

    insertMinuteBarsIfAbsent: (bars) =>
      writeBars(
        bars,
        (values) => sql`
          INSERT INTO candles_1m (token, bucket, open, high, low, close, volume)
          SELECT * FROM (${values}) AS v (token, bucket, open, high, low, close, volume)
           WHERE NOT EXISTS (
             SELECT 1 FROM candles_1m c
              WHERE c.token = v.token AND c.bucket >= v.bucket
                AND c.bucket < v.bucket + interval '1 day')
          ON CONFLICT (token, bucket) DO NOTHING`,
      ),

    async readBars(token, interval, from, to) {
      const name = RELATION[interval];
      // The type already limits `interval`; a value from outside it must never reach sql.raw.
      if (!name) throw new Error(`No stored candles for interval ${String(interval)}`);
      const relation = sql.raw(name);
      const result = await database.db.execute<BarRow>(sql`
        SELECT token, bucket, open, high, low, close, volume FROM ${relation}
         WHERE token = ${token}
           AND bucket >= ${from.toISOString()}::timestamptz
           AND bucket < ${to.toISOString()}::timestamptz
         ORDER BY bucket`);
      return result.rows.map(toBar);
    },
  };
}
