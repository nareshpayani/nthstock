import type { Candle } from '@nthstock/contracts';
import type { CandlestickData, LineData, UTCTimestamp } from 'lightweight-charts';
import type { ChartDirection } from './chartFormat';

/** ISO UTC → the chart's UTC seconds. Labels are formatted in IST by the theme. */
export const toChartTime = (iso: string): UTCTimestamp =>
  Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;

/** Closes for an area series, values kept as integers (paise or hundredths of a point). */
export function toAreaData(candles: readonly Candle[]): LineData<UTCTimestamp>[] {
  return candles.map((candle) => ({ time: toChartTime(candle.t), value: candle.c }));
}

export function toCandleData(candles: readonly Candle[]): CandlestickData<UTCTimestamp>[] {
  return candles.map((candle) => ({
    time: toChartTime(candle.t),
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
  }));
}

/**
 * Heikin-Ashi bars (NSTOCK-0430): smoothed candles drawn from the real ones, so a run of rises or
 * falls reads as one colour. close = mean of O, H, L, C; open = midpoint of the previous HA bar
 * (the first bar's own open and close); high and low take in the HA open and close. Values are
 * rounded to whole paise (or hundredths of a point). Bar i depends only on bars 0..i, so a live
 * tick on the last bar changes only the last HA bar.
 */
export function toHeikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  let previous: { o: number; c: number } | null = null;
  for (const candle of candles) {
    const c = Math.round((candle.o + candle.h + candle.l + candle.c) / 4);
    const o: number = previous
      ? Math.round((previous.o + previous.c) / 2)
      : Math.round((candle.o + candle.c) / 2);
    out.push({ ...candle, o, c, h: Math.max(candle.h, o, c), l: Math.min(candle.l, o, c) });
    previous = { o, c };
  }
  return out;
}

/** Direction of the move across the series: last close against the first bar's open. */
export function seriesDirection(candles: readonly Candle[]): ChartDirection {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) return 'flat';
  return last.c > first.o ? 'up' : last.c < first.o ? 'down' : 'flat';
}
