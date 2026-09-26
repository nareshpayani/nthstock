import type { CandleRange } from '@nthstock/contracts';
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

/** "1 day", "5 years": a range spelled out for accessible names. */
export const rangeLabel = (range: CandleRange): string => strings.ranges[range];
