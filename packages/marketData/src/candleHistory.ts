import type { Candle } from '@nthstock/contracts';
import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import {
  MARKET_CLOSE,
  MARKET_OPEN,
  fromIst,
  isTradingDay,
  istDateKey,
  nseHolidays2026,
  toIstParts,
  type HolidayTable,
} from '@nthstock/utils';
import { bridgeCandles } from './candles.js';
import { NIFTY_50, NIFTY_BANK, NIFTY_IT, SENSEX_30 } from './largeCaps.js';
import { roundToTick } from './price.js';
import { hashSeed, mulberry32, randomNormal } from './prng.js';
import { SECTOR_GBM, type GbmParams } from './sectors.js';
import type { MasterEquity, SymbolMaster } from './symbolMaster.js';
import { SESSION_MINUTES } from './ticks.js';

/**
 * Deterministic candle history for the seed job (spec market-data-and-matching §7.2,
 * NSTOCK-0374): daily bars for the last two years and one-minute bars for the last 30 days, the
 * same on every machine for the same as-of. The daily path is a seeded Brownian bridge that ends
 * at the master's previous close (`basePrice`, the price every mock session opens from) and, for
 * an equity, passes its simulated one-year return a year back; a day's minute bars bridge that
 * day's open to its close, so the daily and the intraday views agree.
 */

/** Volatility and drift used for index levels (constituents are diversified). */
export const INDEX_GBM: GbmParams = { drift: 0.11, volatility: 0.15 };
/** Rough share of a company's shares traded per session. */
export const DAILY_TURNOVER = 0.004;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** An equity's GBM parameters: its sector's, with more volatility for mid and small caps. */
export function equityGbm(master: MasterEquity): GbmParams {
  const params = SECTOR_GBM[master.sector];
  const scale = master.capBucket === 'SMALL' ? 1.4 : master.capBucket === 'MID' ? 1.2 : 1;
  return { drift: params.drift, volatility: params.volatility * scale };
}

/** 9:15 IST on the IST calendar day `offset` days before `date`'s. */
function openDaysBefore(date: Date, offset: number): Date {
  const { year, month, day } = toIstParts(date);
  return fromIst(year, month, day - offset, MARKET_OPEN);
}

/** The 9:15 IST open of the latest session that has closed (15:30 IST) at or before `now`. */
export function latestClosedSessionOpen(now: Date, holidays: HolidayTable = nseHolidays2026): Date {
  const sessionMs = (MARKET_CLOSE - MARKET_OPEN) * MINUTE_MS;
  for (let offset = 0; offset <= 366; offset += 1) {
    const open = openDaysBefore(now, offset);
    if (open.getTime() + sessionMs <= now.getTime() && isTradingDay(open, holidays)) return open;
  }
  throw new Error('No trading day found in the past year; check the holiday table');
}

export type HistoryCalendarOptions = {
  /** Years of daily bars (whole months count, so 0.25 is three months); default 2. */
  years?: number;
  /** Calendar days of one-minute bars; default 30. */
  minuteDays?: number;
  /**
   * At least this many sessions of one-minute bars, so the 1M chart (22 sessions of hourly bars)
   * reads minutes for every session; default 22.
   */
  minMinuteSessions?: number;
  holidays?: HolidayTable;
};

/** Which sessions the history covers, as 9:15 IST opens, oldest first. */
export type HistoryCalendar = {
  /** The last session in the history: the latest closed one at the as-of time. */
  asOf: Date;
  /** Every session of the daily history, `asOf` last. */
  daily: Date[];
  /** The sessions that also get one-minute bars: the tail of `daily`. */
  minute: Date[];
};

/** The sessions of the history that ends with the latest session closed at `now`. */
export function historyCalendar(now: Date, options: HistoryCalendarOptions = {}): HistoryCalendar {
  const holidays = options.holidays ?? nseHolidays2026;
  const years = options.years ?? 2;
  const minuteDays = options.minuteDays ?? 30;
  const minSessions = options.minMinuteSessions ?? 22;
  const asOf = latestClosedSessionOpen(now, holidays);
  const { year, month, day } = toIstParts(asOf);
  const since = fromIst(year, month - Math.round(years * 12), day, MARKET_OPEN).getTime();
  const daily: Date[] = [];
  for (let offset = 0; ; offset += 1) {
    const open = openDaysBefore(asOf, offset);
    if (open.getTime() <= since) break;
    if (isTradingDay(open, holidays)) daily.push(open);
  }
  daily.reverse();
  const minuteSince = asOf.getTime() - minuteDays * DAY_MS;
  const inWindow = daily.filter((open) => open.getTime() > minuteSince).length;
  const minute = daily.slice(-Math.min(daily.length, Math.max(inWindow, minSessions)));
  return { asOf, daily, minute };
}

export type SessionMinutesInput = {
  /** The session's 9:15 IST open. */
  open: Date;
  /** The session's daily bar: the minutes open at its open and close at its close. */
  day: Candle;
  volatility: number;
  seed: number;
  tick?: number;
};

/**
 * The 375 one-minute bars of one session, 9:15 to 15:29 IST: a seeded bridge from the daily bar's
 * open to its close, with the day's volume spread over the minutes.
 */
export function sessionMinuteBars(input: SessionMinutesInput): Candle[] {
  const times = Array.from(
    { length: SESSION_MINUTES },
    (_, m) => new Date(input.open.getTime() + m * MINUTE_MS),
  );
  return bridgeCandles({
    times,
    startPrice: input.day.o,
    endPrice: input.day.c,
    volatility: input.volatility,
    barMinutes: 1,
    seed: input.seed,
    sessionVolume: input.day.v,
    ...(input.tick === undefined ? {} : { tick: input.tick }),
  });
}

export type InstrumentHistory = {
  token: number;
  symbol: string;
  /** One bar per session of `calendar.daily`, oldest first. */
  daily: Candle[];
  /** The minute bars of `calendar.minute`, oldest first; empty unless asked for. */
  minutes: Candle[];
};

/**
 * The history of one instrument of `master` (an equity or an index) over `calendar`, or null for
 * an unknown symbol. Seeds come from the master's seed, the token and the session's date, so the
 * same master and calendar give the same bars everywhere.
 */
export function instrumentHistory(
  master: SymbolMaster,
  symbol: string,
  calendar: HistoryCalendar,
  options: { minutes: boolean },
): InstrumentHistory | null {
  const equity = master.equityBySymbol.get(symbol);
  const index = equity ? undefined : master.indexBySymbol.get(symbol);
  const instrument = equity?.instrument ?? index?.instrument;
  if (!instrument) return null;
  const { token } = instrument;
  const sessions = calendar.daily;
  const gbm = equity ? equityGbm(equity) : INDEX_GBM;
  const tick = equity ? TICK_SIZE_PAISE : 1;
  const endPrice = equity ? equity.basePrice : (index as { baseLevel: number }).baseLevel;
  const sessionVolume = equity ? equity.sharesOutstanding * DAILY_TURNOVER : 0;
  const seed = (...parts: (string | number)[]) => hashSeed(master.seed, 'history', token, ...parts);
  const rng = mulberry32(seed('start'));
  const logMove = (years: number) =>
    (gbm.drift - (gbm.volatility * gbm.volatility) / 2) * years +
    gbm.volatility * Math.sqrt(years) * randomNormal(rng);
  const bridge = (times: Date[], startPrice: number, end: number, part: string) =>
    times.length === 0
      ? []
      : bridgeCandles({
          times,
          startPrice,
          endPrice: end,
          volatility: gbm.volatility,
          barMinutes: SESSION_MINUTES,
          seed: seed('daily', part),
          sessionVolume,
          tick,
        });

  let daily: Candle[];
  const last = sessions.at(-1);
  if (equity && last) {
    // Pinned a year back to the simulated one-year return, as the 1Y chart and "Best returns" are.
    const { year, month, day } = toIstParts(last);
    const yearAgo = fromIst(year - 1, month, day, MARKET_OPEN).getTime();
    const pivot = sessions.findIndex((open) => open.getTime() > yearAgo);
    const anchor = roundToTick(endPrice / (1 + equity.return1yBp / 10_000), tick);
    const older = sessions.slice(0, Math.max(pivot, 0));
    const start = roundToTick(anchor / Math.exp(logMove(Math.max(older.length, 1) / 252)), tick);
    daily = [
      ...bridge(older, start, anchor, 'older'),
      ...bridge(
        sessions.slice(Math.max(pivot, 0)),
        older.length > 0 ? anchor : start,
        endPrice,
        'year',
      ),
    ];
  } else {
    const start = roundToTick(endPrice / Math.exp(logMove(sessions.length / 252)), tick);
    daily = bridge(sessions, start, endPrice, 'all');
  }

  const minutes: Candle[] = [];
  if (options.minutes) {
    const first = sessions.length - calendar.minute.length;
    for (let k = first; k < sessions.length; k += 1) {
      const open = sessions[k] as Date;
      minutes.push(
        ...sessionMinuteBars({
          open,
          day: daily[k] as Candle,
          volatility: gbm.volatility,
          seed: seed('minutes', istDateKey(open)),
          tick,
        }),
      );
    }
  }
  return { token, symbol, daily, minutes };
}

/**
 * The instruments that get one-minute bars by default: the indices and the members of NIFTY 50,
 * SENSEX, NIFTY BANK and NIFTY IT (the large caps), about 65 symbols. Indices first.
 */
export function defaultMinuteSymbols(master: SymbolMaster): string[] {
  const symbols = new Set<string>(master.indices.map((index) => index.instrument.symbol));
  for (const symbol of [...NIFTY_50, ...SENSEX_30, ...NIFTY_BANK, ...NIFTY_IT]) {
    if (master.equityBySymbol.has(symbol)) symbols.add(symbol);
  }
  return [...symbols];
}
