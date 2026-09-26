import type { CandleRange, Exchange } from '@nthstock/contracts';

export type ChartType = 'area' | 'candle';
export const CHART_TYPES = ['area', 'candle'] as const satisfies readonly ChartType[];
export const DEFAULT_CHART_TYPE: ChartType = 'area';

/** Stock detail URL state (ADR 0005), validated in the route file. Every key is optional. */
export type StockDetailSearch = {
  /** Chart range; the chart's default when absent. */
  range?: CandleRange | undefined;
  /** Exchange to show; the instrument's own listing when absent. */
  exchange?: Exchange | undefined;
  /** Area or candle chart. */
  chart?: ChartType | undefined;
};
