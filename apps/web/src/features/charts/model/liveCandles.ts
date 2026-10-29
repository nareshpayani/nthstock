import {
  INTRADAY_INTERVAL_MINUTES,
  type Candle,
  type CandleInterval,
  type Quote,
} from '@nthstock/contracts';
import { MARKET_OPEN, fromIst, sessionBarStart, toIstParts } from '@nthstock/utils';

/** One trade as the chart needs it: price (paise), time (epoch ms) and volume since the last. */
export type LiveTick = { price: number; at: number; volumeDelta: number };

/** A quote → tick; the volume delta comes from the previous quote's cumulative day volume. */
export function quoteToTick(quote: Quote, previous: Quote | undefined): LiveTick {
  const delta = previous ? quote.volume - previous.volume : 0;
  return { price: quote.ltp, at: Date.parse(quote.ts), volumeDelta: Math.max(0, delta) };
}

const DAY_MS = 86_400_000;

/**
 * When the `interval` bar holding `at` opens (epoch ms). Intraday bars count from the 9:15 open as
 * the API's do (NSTOCK-0343); a daily bar opens at its day's 9:15 and a weekly bar at its Monday's,
 * as the generated ones do (NSTOCK-0441).
 */
export function barStartOf(at: number, interval: CandleInterval): number {
  const minutes = INTRADAY_INTERVAL_MINUTES[interval];
  if (minutes !== null) return sessionBarStart(at, minutes);
  const { weekday } = toIstParts(new Date(at));
  const day = interval === '1w' ? new Date(at - ((weekday + 6) % 7) * DAY_MS) : new Date(at);
  const { year, month, day: date } = toIstParts(day);
  return fromIst(year, month, date, MARKET_OPEN).getTime();
}

/**
 * Folds one tick into `interval` bars (T-108; every bar size since NSTOCK-0343, daily and weekly
 * bars too since NSTOCK-0441). A tick in the last bar updates that bar (close, high, low, volume);
 * a tick in a later bar appends a bar opening at the tick's price, a new day's included, so a
 * market that trades past midnight (the demo forced open) keeps drawing. An older tick leaves the
 * bars untouched and returns the same array. Every unchanged bar keeps its identity, which is
 * what lets the chart update just the last bar instead of redrawing.
 */
export function applyTick(
  candles: readonly Candle[],
  tick: LiveTick,
  interval: CandleInterval = '1m',
): readonly Candle[] {
  if (!Number.isFinite(tick.at)) return candles;
  const start = barStartOf(tick.at, interval);
  const { price, volumeDelta } = tick;
  const last = candles[candles.length - 1];
  const fresh = (): Candle => ({
    t: new Date(start).toISOString(),
    o: price,
    h: price,
    l: price,
    c: price,
    v: volumeDelta,
  });
  if (!last) return [fresh()];

  const lastStart = barStartOf(Date.parse(last.t), interval);
  if (start < lastStart) return candles;
  if (start === lastStart) {
    const updated: Candle = {
      ...last,
      h: Math.max(last.h, price),
      l: Math.min(last.l, price),
      c: price,
      v: last.v + volumeDelta,
    };
    if (
      updated.h === last.h &&
      updated.l === last.l &&
      updated.c === last.c &&
      updated.v === last.v
    )
      return candles;
    return [...candles.slice(0, -1), updated];
  }
  return [...candles, fresh()];
}

/**
 * The bars to push with `series.update` when `next` only changed or appended at the end of `prev`
 * (live ticks), in order; `null` when anything else changed and the series needs `setData`.
 */
export function trailingChanges(
  prev: readonly Candle[],
  next: readonly Candle[],
): readonly Candle[] | null {
  if (prev.length === 0 || next.length < prev.length || next.length > prev.length + 1) return null;
  let first = 0;
  while (first < prev.length && next[first] === prev[first]) first += 1;
  if (first < prev.length - 1) return null;
  return next.slice(first);
}
