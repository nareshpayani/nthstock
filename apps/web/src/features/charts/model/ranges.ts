import { CANDLE_INTERVALS, type CandleInterval, type CandleRange } from '@nthstock/contracts';
import { strings } from '../strings';

export const CHART_RANGES = [
  '1D',
  '1W',
  '1M',
  '1Y',
  '5Y',
] as const satisfies readonly CandleRange[];
export const DEFAULT_CHART_RANGE: CandleRange = '1Y';

/** Ranges whose bars are shorter than a day, so the axis shows times. */
export const isIntraday = (range: CandleRange) => range === '1D' || range === '1W';

/** The NIFTY 50 as the feed names it. */
export const NIFTY = { symbol: 'NIFTY50', exchange: 'NSE' } as const;

/**
 * The bar size a chart shows (NSTOCK-0343): `interval` when the range offers it, else the range's
 * own (1 minute on 1D, 5 minutes on 1W, …).
 */
export function resolveInterval(range: CandleRange, interval?: CandleInterval): CandleInterval {
  const offered = CANDLE_INTERVALS[range];
  return interval !== undefined && offered.includes(interval) ? interval : offered[0];
}

/** The chosen bar size to keep when the range changes: kept if the new range offers it. */
export const keepInterval = (
  range: CandleRange,
  interval: CandleInterval | undefined,
): CandleInterval | undefined =>
  interval !== undefined && CANDLE_INTERVALS[range].includes(interval) ? interval : undefined;

/** "15-minute", "daily": a bar size spelled out for accessible names. */
export const intervalLabel = (interval: CandleInterval): string => strings.intervals[interval];

/** "1 day", "5 years": a range spelled out for accessible names. */
export const rangeLabel = (range: CandleRange): string => strings.ranges[range];
