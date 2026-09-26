import type { TooltipContent } from '../model/chartTooltip';

export type ChartTooltipState = TooltipContent & { x: number; width: number };

const TOOLTIP_WIDTH = 168;
const GAP = 12;

/**
 * The crosshair tooltip box (T-107): IST time and ₹ values of the hovered bar, placed beside the
 * crosshair and kept inside the chart. A pointer aid only: the chart's figure carries a text
 * summary for assistive technology, so the box is hidden from it.
 */
export function ChartTooltip({ time, rows, x, width }: ChartTooltipState) {
  const right = x + GAP + TOOLTIP_WIDTH <= width;
  const left = right ? x + GAP : Math.max(0, x - GAP - TOOLTIP_WIDTH);
  return (
    <div
      aria-hidden="true"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute top-2 z-10 grid gap-1 rounded-md border border-line bg-surface px-3 py-2 shadow-raised"
      style={{ left, width: TOOLTIP_WIDTH }}
    >
      <p className="text-label text-ink-muted">{time}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-label">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className="m-0 text-right font-mono text-ink tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
