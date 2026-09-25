import { nseHolidays2026 } from './nseHolidays2026.js';
import { fromIst, istDateKey, toIstParts, type Clock } from './time.js';

/** NSE equity session times in IST, as minutes since midnight. */
export const PRE_OPEN_START = 9 * 60;
export const MARKET_OPEN = 9 * 60 + 15;
export const MARKET_CLOSE = 15 * 60 + 30;

export type MarketState = 'preOpen' | 'open' | 'closed';
export type ClosedReason = 'beforeHours' | 'afterHours' | 'weekend' | 'holiday';

export type MarketStatus =
  { state: 'preOpen' | 'open' } | { state: 'closed'; reason: ClosedReason; holidayName?: string };

/** Holidays keyed by IST date ("2026-01-26"). Swap in a different table for tests or later years. */
export type HolidayTable = Readonly<Record<string, string>>;

function holidayName(date: Date, holidays: HolidayTable): string | undefined {
  return holidays[istDateKey(date)];
}

/** True when the IST calendar day of `date` is a weekday and not a listed holiday. */
export function isTradingDay(date: Date, holidays: HolidayTable = nseHolidays2026): boolean {
  const { weekday } = toIstParts(date);
  return weekday !== 0 && weekday !== 6 && holidayName(date, holidays) === undefined;
}

/**
 * Pre-open runs 9:00–9:15 IST and the normal session 9:15–15:30 IST (open at 9:15:00, closed from
 * 15:30:00).
 */
export function getMarketStatus(
  clock: Clock,
  holidays: HolidayTable = nseHolidays2026,
): MarketStatus {
  const now = clock.now();
  const { weekday, minuteOfDay } = toIstParts(now);
  if (weekday === 0 || weekday === 6) return { state: 'closed', reason: 'weekend' };
  const holiday = holidayName(now, holidays);
  if (holiday !== undefined) return { state: 'closed', reason: 'holiday', holidayName: holiday };
  if (minuteOfDay < PRE_OPEN_START) return { state: 'closed', reason: 'beforeHours' };
  if (minuteOfDay < MARKET_OPEN) return { state: 'preOpen' };
  if (minuteOfDay < MARKET_CLOSE) return { state: 'open' };
  return { state: 'closed', reason: 'afterHours' };
}

/**
 * The next 9:15 IST normal-session open strictly after now (today's if it hasn't happened yet).
 * During the session it returns the next trading day's open.
 */
export function nextSessionOpen(clock: Clock, holidays: HolidayTable = nseHolidays2026): Date {
  const now = clock.now();
  const { year, month, day } = toIstParts(now);
  for (let offset = 0; offset <= 366; offset += 1) {
    const candidate = fromIst(year, month, day + offset, MARKET_OPEN);
    if (candidate.getTime() > now.getTime() && isTradingDay(candidate, holidays)) return candidate;
  }
  throw new Error('No trading day found in the next year; check the holiday table');
}
