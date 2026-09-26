import { formatIndexLevel } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';

/** What the chart's numbers are: rupees in paise, or an index level in hundredths of a point. */
export type ChartValueFormat = 'inr' | 'index';
export type ChartDirection = 'up' | 'down' | 'flat';

/** Chart values stay integers (paise or hundredths); only the labels turn them into ₹ or points. */
export function formatChartValue(value: number, format: ChartValueFormat): string {
  const whole = Math.round(value);
  return format === 'index' ? formatIndexLevel(whole) : formatInr(whole);
}
