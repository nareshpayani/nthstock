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

/** Direction of the move across the series: last close against the first bar's open. */
export function seriesDirection(candles: readonly Candle[]): ChartDirection {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) return 'flat';
  return last.c > first.o ? 'up' : last.c < first.o ? 'down' : 'flat';
}
