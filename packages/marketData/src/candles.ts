import type { Candle, CandleInterval, CandleRange } from '@nthstock/contracts';
import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import {
  MARKET_CLOSE,
  MARKET_OPEN,
  fromIst,
  getMarketStatus,
  isTradingDay,
  istDateKey,
  nseHolidays2026,
  toIstParts,
  type Clock,
  type HolidayTable,
} from '@nthstock/utils';
import { roundToTick } from './price.js';
import { mulberry32, randomNormal, type Rng } from './prng.js';
import { SESSION_MINUTES, TRADING_DAYS_PER_YEAR } from './ticks.js';

/**
 * Bar size per range. The task asks for 30-minute bars on 1M, but the contract's CandleInterval has
 * no `30m`, so 1M uses hourly bars until the contract adds it.
 */
export const CANDLE_SPECS: Readonly<
  Record<CandleRange, { interval: CandleInterval; barMinutes: number; sessions: number }>
> = {
  '1D': { interval: '1m', barMinutes: 1, sessions: 1 },
  '1W': { interval: '5m', barMinutes: 5, sessions: 5 },
  '1M': { interval: '1h', barMinutes: 60, sessions: 22 },
  '1Y': { interval: '1d', barMinutes: SESSION_MINUTES, sessions: 0 },
  '5Y': { interval: '1w', barMinutes: SESSION_MINUTES * 5, sessions: 0 },
};

/** Trading years each range spans, used to size moves and volatility. */
export const RANGE_YEARS: Readonly<Record<CandleRange, number>> = {
  '1D': 1 / TRADING_DAYS_PER_YEAR,
  '1W': 5 / TRADING_DAYS_PER_YEAR,
  '1M': 22 / TRADING_DAYS_PER_YEAR,
  '1Y': 1,
  '5Y': 5,
};

const DAY_MS = 86_400_000;

/** 9:15 IST on the IST calendar day `offset` days before `date`'s. */
function sessionOpenDaysBefore(date: Date, offset: number): Date {
  const { year, month, day } = toIstParts(date);
  return fromIst(year, month, day - offset, MARKET_OPEN);
}

/**
 * The most recent session that has started: today's if it is a trading day and 9:15 IST has passed,
 * otherwise the previous trading day. Returns that session's 9:15 IST open.
 */
export function latestSessionOpen(now: Date, holidays: HolidayTable = nseHolidays2026): Date {
  for (let offset = 0; offset <= 366; offset += 1) {
    const open = sessionOpenDaysBefore(now, offset);
    if (open.getTime() <= now.getTime() && isTradingDay(open, holidays)) return open;
  }
  throw new Error('No trading day found in the past year; check the holiday table');
}

/** Session opens (9:15 IST) of trading days, oldest first, back to `sinceMs` (exclusive). */
function tradingDaysSince(anchor: Date, sinceMs: number, holidays: HolidayTable): Date[] {
  const days: Date[] = [];
  for (let offset = 0; ; offset += 1) {
    const open = sessionOpenDaysBefore(anchor, offset);
    if (open.getTime() <= sinceMs) break;
    if (isTradingDay(open, holidays)) days.push(open);
  }
  return days.reverse();
}

/** Monday-based week key of an IST date, so weekly bars group Mon–Fri. */
function weekKey(date: Date): string {
  const { weekday } = toIstParts(date);
  const monday = new Date(date.getTime() - ((weekday + 6) % 7) * DAY_MS);
  return istDateKey(monday);
}

/** Bar open times for a range, oldest first, ending with the bar containing `now` (or the last close). */
export function candleTimes(
  range: CandleRange,
  clock: Clock,
  holidays: HolidayTable = nseHolidays2026,
): Date[] {
  const now = clock.now();
  const anchor = latestSessionOpen(now, holidays);
  const spec = CANDLE_SPECS[range];

  if (range === '1Y' || range === '5Y') {
    const years = range === '1Y' ? 1 : 5;
    const { year, month, day } = toIstParts(anchor);
    const since = fromIst(year - years, month, day, MARKET_OPEN).getTime();
    const days = tradingDaysSince(anchor, since, holidays);
    if (range === '1Y') return days;
    const weeks = new Map<string, Date>();
    for (const d of days) if (!weeks.has(weekKey(d))) weeks.set(weekKey(d), d);
    return [...weeks.values()];
  }

  // Intraday: the last N sessions; today's session stops at the bar containing now while open.
  const sessions: Date[] = [];
  for (let offset = 0; sessions.length < spec.sessions; offset += 1) {
    const open = sessionOpenDaysBefore(anchor, offset);
    if (isTradingDay(open, holidays)) sessions.unshift(open);
  }
  const inSession = getMarketStatus(clock, holidays).state === 'open';
  const times: Date[] = [];
  for (const open of sessions) {
    const lastMinute =
      inSession && open.getTime() === anchor.getTime()
        ? Math.floor((now.getTime() - open.getTime()) / 60_000)
        : MARKET_CLOSE - MARKET_OPEN - 1;
    for (let m = 0; m <= lastMinute; m += spec.barMinutes) {
      times.push(new Date(open.getTime() + m * 60_000));
    }
  }
  return times;
}

export type CandleInput = {
  range: CandleRange;
  clock: Clock;
  /** Close of the last bar: the current LTP, exactly. */
  endPrice: number;
  /** Open of the first bar; the path is a Brownian bridge from here to `endPrice`. */
  startPrice: number;
  /** Annualised volatility for the bar-to-bar noise. */
  volatility: number;
  seed: number;
  /** Average volume per full session; spread across bars. 0 for indices. */
  sessionVolume?: number;
  holidays?: HolidayTable;
  /** Price step: 5 paise for equities, 1 for index levels. */
  tick?: number;
};

export type CandleOutput = { interval: CandleInterval; candles: Candle[] };

function wick(rng: Rng, price: number, sigmaBar: number): number {
  return Math.abs(randomNormal(rng)) * sigmaBar * price * 0.5;
}

/**
 * Generates OHLCV bars on trading days only (weekends and `holidays` skipped). Closes follow a
 * seeded Brownian bridge in log space from `startPrice` to `endPrice`, so the last close equals the
 * LTP; every bar satisfies low ≤ open, close ≤ high, and every price is on `tick`.
 */
export function generateCandles(input: CandleInput): CandleOutput {
  const tick = input.tick ?? TICK_SIZE_PAISE;
  const holidays = input.holidays ?? nseHolidays2026;
  const spec = CANDLE_SPECS[input.range];
  const times = candleTimes(input.range, input.clock, holidays);
  const rng = mulberry32(input.seed);
  const n = times.length;

  const barYears = spec.barMinutes / SESSION_MINUTES / TRADING_DAYS_PER_YEAR;
  const sigmaBar = input.volatility * Math.sqrt(barYears);
  const start = Math.log(Math.max(input.startPrice, tick));
  const end = Math.log(Math.max(input.endPrice, tick));

  // Random walk W_1..W_n, then pin W_n to the required end: x_k = start + W_k − (k/n)(W_n − Δ).
  const walk: number[] = [];
  let w = 0;
  for (let k = 0; k < n; k += 1) {
    w += sigmaBar * randomNormal(rng);
    walk.push(w);
  }
  const shift = w - (end - start);

  const barVolume = (input.sessionVolume ?? 0) * (spec.barMinutes / SESSION_MINUTES);
  const candles: Candle[] = [];
  let prevClose = roundToTick(input.startPrice, tick);
  for (let k = 0; k < n; k += 1) {
    const time = times[k] as Date;
    const x = start + (walk[k] as number) - ((k + 1) / n) * shift;
    const c = k === n - 1 ? input.endPrice : roundToTick(Math.exp(x), tick);
    const o = prevClose;
    const h = Math.max(o, c) + roundToTick(wick(rng, c, sigmaBar), tick) - tick;
    const l = Math.max(tick, Math.min(o, c) - roundToTick(wick(rng, c, sigmaBar), tick) + tick);
    const v = barVolume > 0 ? Math.round(barVolume * (0.4 + 1.2 * rng())) : 0;
    candles.push({ t: time.toISOString(), o, h, l, c, v });
    prevClose = c;
  }
  return { interval: spec.interval, candles };
}
