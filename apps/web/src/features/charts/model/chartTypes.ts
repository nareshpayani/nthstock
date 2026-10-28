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

/** Types drawn from whole bars (open, high, low, close) rather than closes alone. */
export const isBarType = (type: PriceChartType) =>
  type === 'candle' || type === 'bar' || type === 'heikin';
