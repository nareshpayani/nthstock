import { strings } from '../strings';

/**
 * The price chart's types (NSTOCK-0430). All are drawn from the same candles: `line` and `area`
 * from the closes, `candle` and `bar` from the full bars, and `heikin` from Heikin-Ashi bars
 * computed in the browser (smoothed, not traded prices).
 */
export type PriceChartType = 'line' | 'area' | 'candle' | 'bar' | 'heikin';

export const PRICE_CHART_TYPES = [
  'line',
  'area',
  'candle',
  'bar',
  'heikin',
] as const satisfies readonly PriceChartType[];

/** The dashboard's NIFTY 50 chart opens as a line (NSTOCK-0443, owner request). */
export const DEFAULT_INDEX_CHART_TYPE: PriceChartType = 'line';

/** Types drawn from whole bars (open, high, low, close) rather than closes alone. */
export const isBarType = (type: PriceChartType) =>
  type === 'candle' || type === 'bar' || type === 'heikin';

/** "candlestick", "OHLC bar": a type as it reads inside a chart's accessible name. */
export const chartTypeName = (type: PriceChartType): string => strings.typeNames[type];
