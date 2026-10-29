import type { Candle } from '@nthstock/contracts';
import { formatChange, type ChangeDirection } from '@nthstock/utils';
import { strings } from '../strings';
import { formatChartValue, type ChartValueFormat } from './chartFormat';
import type { StudyLine } from './studies';

export type LegendValue = { label: string; value: string };
export type LegendStudy = { key: string; label: string; value: string };
export type LegendContent = {
  values: LegendValue[];
  change: { text: string; direction: ChangeDirection; srLabel: string };
  volume: string | null;
  studies: LegendStudy[];
};

const compact = (value: number, size: number, suffix: string) =>
  `${(Math.round((value / size) * 100) / 100).toString()}${suffix}`;

/** Shares traded, short: 12,34,567 → "12.35L", 2,50,00,000 → "2.5Cr", 4,200 → "4.2K". */
export function formatVolume(volume: number): string {
  if (volume >= 10_000_000) return compact(volume, 10_000_000, 'Cr');
  if (volume >= 100_000) return compact(volume, 100_000, 'L');
  if (volume >= 1_000) return `${(Math.round(volume / 100) / 10).toString()}K`;
  return String(volume);
}

/**
 * The chart legend's text (NSTOCK-0460): open, high, low and close of the bar under the crosshair
 * (the last bar when nothing is held), its change on the bar before (on its own open for the first
 * bar), its volume, and each indicator's value at that bar, as bare numbers.
 */
export function legendContent(
  candles: readonly Candle[],
  index: number,
  lines: readonly StudyLine[],
  { format, volume }: { format: ChartValueFormat; volume: boolean },
): LegendContent | null {
  const bar = candles[index];
  if (!bar) return null;
  const base = candles[index - 1]?.c ?? bar.o;
  const basisPoints = base > 0 ? Math.round(((bar.c - base) * 10_000) / base) : 0;
  // No ₹ on each value: the legend is a row of numbers, and it has to fit a 320 px phone.
  const show = (value: number) => formatChartValue(value, format).replace('₹', '');
  return {
    values: [
      { label: strings.legend.open, value: show(bar.o) },
      { label: strings.legend.high, value: show(bar.h) },
      { label: strings.legend.low, value: show(bar.l) },
      { label: strings.legend.close, value: show(bar.c) },
    ],
    change: formatChange(basisPoints),
    volume: volume ? formatVolume(bar.v) : null,
    studies: lines.flatMap((line) => {
      const value = line.values[index];
      return value === null || value === undefined
        ? []
        : [{ key: line.key, label: strings.studyShort[line.key] ?? line.key, value: show(value) }];
    }),
  };
}
