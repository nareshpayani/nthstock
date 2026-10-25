import {
  INTRADAY_INTERVAL_MINUTES,
  type Candle,
  type CandleInterval,
  type CandleRange,
  type Quote,
} from '@nthstock/contracts';
import { CANDLE_SPECS, candleTimes, latestSessionOpen } from '@nthstock/marketData';
import {
  MARKET_CLOSE,
  MARKET_OPEN,
  getMarketStatus,
  istDateKey,
  nseHolidays2026,
  sessionBarStart,
  type Clock,
  type HolidayTable,
} from '@nthstock/utils';
import type { StoredInterval } from './store.js';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const SESSION_BAR_MINUTES = MARKET_CLOSE - MARKET_OPEN;

/**
 * What the candles route reads for one request (NSTOCK-0375, spec market-data-and-matching §7.3):
 * the same bars, over the same sessions, that the generator would show for the range.
 */
export type CandleWindow = {
  range: CandleRange;
  /** The bar size answered: the one asked for, or the range's own. */
  interval: CandleInterval;
  /** The relation read: `1w` is read as `1d` and grouped into weeks. */
  stored: StoredInterval;
  /** Bars opening in `[from, to)`. */
  from: Date;
  to: Date;
  /** The open of the stored bar the live quote belongs to: the last bar of the window. */
  forming: Date;
  /** NSE is in session at the window's clock, so the forming bar is still forming. */
  live: boolean;
};

/**
 * The window of `range` at `clock`, from `candleTimes` (the generator's own bar times): intraday
 * ranges span their last N sessions up to the bar containing now (1D one session, 1W five, 1M
 * 22), 1Y and 5Y span one and five years of sessions up to the latest one.
 */
export function candleWindow(
  range: CandleRange,
  interval: CandleInterval | undefined,
  clock: Clock,
  holidays: HolidayTable = nseHolidays2026,
): CandleWindow {
  const spec = CANDLE_SPECS[range];
  const wanted = interval ?? spec.interval;
  const stored: StoredInterval = wanted === '1w' ? '1d' : wanted;
  const times = candleTimes(range, clock, holidays);
  const anchor = latestSessionOpen(clock.now(), holidays);
  const first = times[0] ?? anchor;
  const last = times.at(-1) ?? anchor;
  const daily = range === '1Y' || range === '5Y';
  const to = daily
    ? new Date(anchor.getTime() + DAY_MS)
    : new Date(last.getTime() + spec.barMinutes * MINUTE_MS);
  // The last bar of the window, in the stored bar size; a daily bar opens at its session's 9:15.
  const reference = daily ? anchor : last;
  const minutes = INTRADAY_INTERVAL_MINUTES[stored] ?? SESSION_BAR_MINUTES;
  return {
    range,
    interval: wanted,
    stored,
    from: first,
    to,
    forming: new Date(sessionBarStart(reference.getTime(), minutes)),
    live: getMarketStatus(clock, holidays).state === 'open',
  };
}

/**
 * Drops the seed's daily-only rows from an intraday read. The seed writes a session outside its
 * minute window (and every session of a symbol without minute bars) as ONE row at 09:15 IST with
 * the whole day's OHLCV, so that `candles_1d` is right; on an intraday chart that row would be one
 * day-sized bar. A session whose only bar opens at its 09:15 is such a row, unless it is the
 * session forming right now (a candle writer that has closed only the 09:15 minute).
 */
export function dropDailyOnlySessions(bars: readonly Candle[], window: CandleWindow): Candle[] {
  if (window.stored === '1d') return [...bars];
  const perDay = new Map<string, Candle[]>();
  for (const bar of bars) {
    const day = istDateKey(new Date(bar.t));
    perDay.set(day, [...(perDay.get(day) ?? []), bar]);
  }
  const formingDay = istDateKey(window.forming);
  return bars.filter((bar) => {
    const day = istDateKey(new Date(bar.t));
    const session = perDay.get(day) ?? [];
    const opensAtNineFifteen =
      sessionBarStart(Date.parse(bar.t), SESSION_BAR_MINUTES) === Date.parse(bar.t);
    const dailyOnly = session.length === 1 && opensAtNineFifteen;
    return !dailyOnly || (window.live && day === formingDay);
  });
}

/**
 * The window's bars with the live quote folded into the forming bar, so the chart's last bar moves
 * with the ticks: the stored bar of that bucket (the minutes the candle writer has closed) gets its
 * high and low widened to the LTP and closes at the LTP; with no stored bar yet, a new one opens at
 * the previous close (a daily bar: at the quote's day open, high and low). A quote older than the
 * forming bucket changes nothing.
 */
export function withLiveQuote(
  bars: readonly Candle[],
  quote: Quote | null,
  window: CandleWindow,
): Candle[] {
  const out = bars.map((bar) => ({ ...bar }));
  if (!quote || Date.parse(quote.ts) < window.forming.getTime()) return out;
  const start = window.forming.toISOString();
  const ltp = quote.ltp;
  const last = out.at(-1);
  if (last && last.t === start) {
    last.h = Math.max(last.h, ltp);
    last.l = Math.min(last.l, ltp);
    last.c = ltp;
    return out;
  }
  if (last && Date.parse(last.t) > window.forming.getTime()) return out;
  if (window.stored === '1d') {
    const open = quote.open > 0 ? quote.open : ltp;
    out.push({
      t: start,
      o: open,
      h: Math.max(open, ltp, quote.high),
      l: Math.min(open, ltp, quote.low > 0 ? quote.low : ltp),
      c: ltp,
      v: quote.volume,
    });
    return out;
  }
  const open = last?.c ?? ltp;
  out.push({ t: start, o: open, h: Math.max(open, ltp), l: Math.min(open, ltp), c: ltp, v: 0 });
  return out;
}
