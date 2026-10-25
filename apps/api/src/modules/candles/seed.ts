import type { Candle } from '@nthstock/contracts';
import {
  defaultMinuteSymbols,
  historyCalendar,
  instrumentHistory,
  type HistoryCalendar,
  type HistoryCalendarOptions,
  type SymbolMaster,
} from '@nthstock/marketData';
import type { Clock } from '@nthstock/utils';
import { Client } from 'pg';
import type { CandleStore, StoredBar } from './store.js';

/**
 * The one-off candle history seed (NSTOCK-0374, spec market-data-and-matching §7.2): two years of
 * daily bars and the last 30 days of one-minute bars from the deterministic generator in
 * `@nthstock/marketData`, so charts have depth on day one and every machine holds the same rows.
 *
 * `candles_1d` is a continuous aggregate over `candles_1m`, so daily history can only enter as
 * minutes. A session inside the minute window gets its 375 one-minute bars; an older session (and
 * every session of a symbol without minute bars) gets ONE row at its 09:15 IST minute carrying the
 * whole day's OHLCV, which `candles_1d` turns into exactly that daily bar. Intraday charts read
 * only the minute window; the route ignores those one-row sessions there (see `window.ts`).
 */

/** The continuous aggregates over `candles_1m`, refreshed after a seed. */
export const CANDLE_AGGREGATES = [
  'candles_5m',
  'candles_15m',
  'candles_30m',
  'candles_1h',
  'candles_1d',
] as const;

/** Bars handed to `upsertMinuteBars` at a time (it splits them into INSERTs of 5,000). */
export const SEED_BATCH_BARS = 50_000;

export type CandleSeedOptions = {
  store: CandleStore;
  master: SymbolMaster;
  /** The as-of clock: the history ends with the latest session closed at `clock.now()`. */
  clock: Clock;
  /**
   * Which instruments get daily history: `default` (the indices and the large caps of the main
   * indices, `defaultMinuteSymbols`), `all` (every instrument in the master, about 5,000), or a
   * list. One-minute bars always go only to the default set (or to the list when one is given).
   */
  symbols?: 'default' | 'all' | readonly string[];
  calendar?: HistoryCalendarOptions;
  /**
   * Materialises the continuous aggregates over the seeded range. Required: real-time aggregation
   * only covers minutes after an aggregate's watermark, and the first refresh policy run moves the
   * watermark to the present, so seeded history that was never materialised would vanish from
   * reads. The app role cannot refresh (`must be owner of view`): the CLI passes
   * `refreshWithOwner(DATABASE_MIGRATION_URL)`.
   */
  refresh: (from: Date, to: Date) => Promise<void>;
  onProgress?: (done: number, total: number, symbol: string) => void;
};

export type CandleSeedSummary = {
  asOf: Date;
  /** The first and last session opens seeded. */
  from: Date;
  to: Date;
  symbols: number;
  minuteSymbols: number;
  rows: number;
};

const toStored = (token: number, bar: Candle): StoredBar => ({
  token,
  bucket: new Date(bar.t),
  open: bar.o,
  high: bar.h,
  low: bar.l,
  close: bar.c,
  volume: bar.v,
});

/**
 * The rows the seed writes for one instrument: its minute bars for the minute window (when
 * `minutes`), and one 09:15 row per other session carrying the daily bar.
 */
export function seedRows(
  master: SymbolMaster,
  symbol: string,
  calendar: HistoryCalendar,
  minutes: boolean,
): StoredBar[] {
  const { daily, minute } = seedRowSets(master, symbol, calendar, minutes);
  return [...daily, ...minute];
}

/**
 * `seedRows` split by how they are written: the minute window is upserted (a rerun replaces it),
 * the one-row daily sessions are inserted only where nothing is stored, so a session that slid out
 * of the minute window since an earlier seed keeps its minute bars instead of gaining a whole-day
 * row on top of its 09:15 minute (which would double its volume in `candles_1d`).
 */
export function seedRowSets(
  master: SymbolMaster,
  symbol: string,
  calendar: HistoryCalendar,
  minutes: boolean,
): { daily: StoredBar[]; minute: StoredBar[] } {
  const history = instrumentHistory(master, symbol, calendar, { minutes });
  if (!history) return { daily: [], minute: [] };
  const dailyOnly = minutes
    ? history.daily.slice(0, history.daily.length - calendar.minute.length)
    : history.daily;
  return {
    daily: dailyOnly.map((bar) => toStored(history.token, bar)),
    minute: history.minutes.map((bar) => toStored(history.token, bar)),
  };
}

function seedSymbols(master: SymbolMaster, choice: CandleSeedOptions['symbols']) {
  if (Array.isArray(choice)) return { daily: [...choice], minutes: new Set<string>(choice) };
  const minutes = new Set(defaultMinuteSymbols(master));
  if (choice === 'all') {
    return {
      daily: [
        ...master.indices.map((index) => index.instrument.symbol),
        ...master.equities.map((equity) => equity.instrument.symbol),
      ],
      minutes,
    };
  }
  return { daily: [...minutes], minutes };
}

/**
 * Writes the history, then refreshes the aggregates. Running it twice with the same as-of leaves
 * the same rows; a later as-of adds the new sessions and keeps the stored ones' minute bars.
 */
export async function seedCandles(options: CandleSeedOptions): Promise<CandleSeedSummary> {
  const calendar = historyCalendar(options.clock.now(), options.calendar);
  const { daily, minutes } = seedSymbols(options.master, options.symbols ?? 'default');
  let pendingDaily: StoredBar[] = [];
  let pendingMinutes: StoredBar[] = [];
  let rows = 0;
  let minuteSymbols = 0;
  const flush = async () => {
    await options.store.insertMinuteBarsIfAbsent(pendingDaily);
    await options.store.upsertMinuteBars(pendingMinutes);
    rows += pendingDaily.length + pendingMinutes.length;
    pendingDaily = [];
    pendingMinutes = [];
  };
  for (const [done, symbol] of daily.entries()) {
    const withMinutes = minutes.has(symbol);
    const sets = seedRowSets(options.master, symbol, calendar, withMinutes);
    if (sets.minute.length > 0) minuteSymbols += 1;
    pendingDaily.push(...sets.daily);
    pendingMinutes.push(...sets.minute);
    if (pendingDaily.length + pendingMinutes.length >= SEED_BATCH_BARS) await flush();
    options.onProgress?.(done + 1, daily.length, symbol);
  }
  await flush();
  const from = calendar.daily[0] ?? calendar.asOf;
  const to = calendar.asOf;
  await options.refresh(from, new Date(to.getTime() + 86_400_000));
  return {
    asOf: calendar.asOf,
    from,
    to,
    symbols: daily.length,
    minuteSymbols,
    rows,
  };
}

/**
 * `CALL refresh_continuous_aggregate` for each aggregate over `[from, to)`, as the role that owns
 * them (nthstock_owner, DATABASE_MIGRATION_URL): the procedure needs the view's owner and must run
 * outside a transaction, so it gets a plain autocommit connection of its own.
 */
export function refreshWithOwner(url: string) {
  return async (from: Date, to: Date): Promise<void> => {
    const client = new Client({ connectionString: url, application_name: 'nthstock-seed' });
    await client.connect();
    try {
      for (const aggregate of CANDLE_AGGREGATES) {
        await client.query(
          `CALL refresh_continuous_aggregate($1::regclass, $2::timestamptz, $3::timestamptz)`,
          [aggregate, from.toISOString(), to.toISOString()],
        );
      }
    } finally {
      await client.end();
    }
  };
}
