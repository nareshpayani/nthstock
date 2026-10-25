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
   * Like `upsertMinuteBars`, but a bar whose token and minute are already stored is left as it is
   * (`ON CONFLICT DO NOTHING`). The seed writes its one-row daily history this way, so a session
   * that already holds minute bars from an earlier seed keeps them.
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
  /** One multi-row INSERT per `UPSERT_CHUNK_ROWS` bars, all in one transaction. */
  const writeBars = async (bars: readonly StoredBar[], onConflict: SQL): Promise<void> => {
    if (bars.length === 0) return;
    await database.transaction(async (tx) => {
      for (let start = 0; start < bars.length; start += UPSERT_CHUNK_ROWS) {
        const rows = bars
          .slice(start, start + UPSERT_CHUNK_ROWS)
          .map(
            (bar) =>
              sql`(${bar.token}, ${bar.bucket.toISOString()}::timestamptz, ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, ${bar.volume})`,
          );
        await tx.execute(sql`
          INSERT INTO candles_1m (token, bucket, open, high, low, close, volume)
          VALUES ${sql.join(rows, sql`, `)}
          ${onConflict}`);
      }
    });
  };
  return {
    upsertMinuteBars: (bars) =>
      writeBars(
        bars,
        sql`ON CONFLICT (token, bucket) DO UPDATE SET
              open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
              close = EXCLUDED.close, volume = EXCLUDED.volume`,
      ),

    insertMinuteBarsIfAbsent: (bars) =>
      writeBars(bars, sql`ON CONFLICT (token, bucket) DO NOTHING`),

    async readBars(token, interval, from, to) {
      const relation = sql.raw(RELATION[interval]);
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
