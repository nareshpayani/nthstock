import type { CandleInterval, CandleRange, Exchange } from '@nthstock/contracts';
import { PRICE_CHART_TYPES, type PriceChartType } from '@/features/charts';

export type ChartType = PriceChartType;
export const CHART_TYPES = PRICE_CHART_TYPES;
export const DEFAULT_CHART_TYPE: ChartType = 'area';
/** Stock detail opens on today's intraday chart, which updates live while NSE is open (T-108). */
export const DEFAULT_STOCK_RANGE: CandleRange = '1D';

/** Stock detail URL state (ADR 0005), validated in the route file. Every key is optional. */
export type StockDetailSearch = {
  /** Chart range; the chart's default when absent. */
  range?: CandleRange | undefined;
  /** Bar size (NSTOCK-0343); the range's own when absent or not offered on the range. */
  interval?: CandleInterval | undefined;
  /** Exchange to show; the instrument's own listing when absent. */
  exchange?: Exchange | undefined;
  /** Line, area, candles, OHLC bars or Heikin-Ashi (NSTOCK-0430). */
  chart?: ChartType | undefined;
};
