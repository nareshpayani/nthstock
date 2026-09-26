import type { Candle, Quote } from '@nthstock/contracts';
import { istDateKey } from '@nthstock/utils';

/** Live 1D bars are one minute long, like the 1D series the API returns (`interval: 1m`). */
export const LIVE_BUCKET_MS = 60_000;

/** One trade as the chart needs it: price (paise), time (epoch ms) and volume since the last. */
export type LiveTick = { price: number; at: number; volumeDelta: number };

/** A quote → tick; the volume delta comes from the previous quote's cumulative day volume. */
export function quoteToTick(quote: Quote, previous: Quote | undefined): LiveTick {
  const delta = previous ? quote.volume - previous.volume : 0;
  return { price: quote.ltp, at: Date.parse(quote.ts), volumeDelta: Math.max(0, delta) };
}

/**
 * Folds one tick into minute bars (T-108). A tick in the last bar's minute updates that bar
 * (close, high, low, volume); a tick in a later minute of the same IST day appends a bar opening
 * at the tick's price. An older tick, or one from another day (the series refetches then), leaves
 * the bars untouched and returns the same array. Every unchanged bar keeps its identity, which is
 * what lets the chart update just the last bar instead of redrawing.
 */
export function applyTick(
  candles: readonly Candle[],
  tick: LiveTick,
  bucketMs: number = LIVE_BUCKET_MS,
): readonly Candle[] {
  if (!Number.isFinite(tick.at)) return candles;
  const start = tick.at - (tick.at % bucketMs);
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

  const lastStart = Date.parse(last.t);
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
  if (istDateKey(new Date(start)) !== istDateKey(new Date(lastStart))) return candles;
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
