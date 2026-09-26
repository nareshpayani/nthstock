import type { Time } from 'lightweight-charts';
import { strings } from '../strings';
import { formatChartValue, type ChartValueFormat } from './chartFormat';
import { formatCrosshairTime } from './chartTheme';

/** A hovered data item as the chart reports it: a close (area) or a full bar (candle). */
export type HoveredItem = {
  time: Time;
  value?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
};

export type TooltipRow = { label: string; value: string };
export type TooltipContent = { time: string; rows: TooltipRow[] };

/**
 * The crosshair tooltip's text (T-107): the bar's time in IST, and its values as en-IN grouped
 * rupees (or index points). `null` for a gap with no value.
 */
export function tooltipContent(
  item: HoveredItem,
  { format, intraday }: { format: ChartValueFormat; intraday: boolean },
): TooltipContent | null {
  const time = formatCrosshairTime(item.time, intraday);
  const show = (value: number) => formatChartValue(value, format);
  const { open, high, low, close } = item;
  if (open !== undefined && high !== undefined && low !== undefined && close !== undefined) {
    return {
      time,
      rows: [
        { label: strings.tooltip.open, value: show(open) },
        { label: strings.tooltip.high, value: show(high) },
        { label: strings.tooltip.low, value: show(low) },
        { label: strings.tooltip.close, value: show(close) },
      ],
    };
  }
  if (item.value === undefined) return null;
  return {
    time,
    rows: [
      {
        label: format === 'index' ? strings.tooltip.level : strings.tooltip.price,
        value: show(item.value),
      },
    ],
  };
}
