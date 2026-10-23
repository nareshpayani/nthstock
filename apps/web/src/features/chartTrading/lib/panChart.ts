import type { IChartApi } from 'lightweight-charts';

/**
 * Pans the time axis by `dx` px, as a one-finger drag on the plot would (SPEC-TFC-1 §9.1). Used
 * when a drag starts on a handle that does not move a price (the position chip), so that drag still
 * pans: the handle holds the pointer, so the chart never sees it.
 */
export function panBy(chart: IChartApi, dx: number): void {
  const time = chart.timeScale();
  const range = time.getVisibleLogicalRange();
  const spacing = time.options().barSpacing;
  if (!range || !(spacing > 0) || dx === 0) return;
  const shift = -dx / spacing;
  time.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
}
