import { IconButton, IconMinus, IconPlus, IconRefresh, cn } from '@nthstock/ui';
import type { IChartApi } from 'lightweight-charts';
import { zoomedLogicalRange } from '../model/chartZoom';
import { strings } from '../strings';

/**
 * − + and reset for a chart you can pan (NSTOCK-0437, A13): zoom with one thumb, no pinch needed.
 * It sits at the plot's bottom left, just above the time axis, where the thumb already is (A18),
 * clear of the TradingView attribution mark in the corner.
 * Zooming keeps the latest bar at the right edge; reset fits every bar again.
 */
export function ChartZoomControls({ chart, className }: { chart: IChartApi; className?: string }) {
  const zoom = (steps: number) => {
    const timeScale = chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    if (visible) timeScale.setVisibleLogicalRange(zoomedLogicalRange(visible, steps));
  };
  return (
    <div
      role="group"
      aria-label={strings.zoom.label}
      data-testid="chart-zoom"
      className={cn(
        'absolute bottom-8 left-12 z-10 flex gap-1 rounded-md border border-line bg-surface/90 p-0.5',
        className,
      )}
    >
      <IconButton
        size="sm"
        label={strings.zoom.out}
        icon={<IconMinus aria-hidden="true" className="size-4" />}
        onClick={() => zoom(-1)}
      />
      <IconButton
        size="sm"
        label={strings.zoom.in}
        icon={<IconPlus aria-hidden="true" className="size-4" />}
        onClick={() => zoom(1)}
      />
      <IconButton
        size="sm"
        label={strings.zoom.reset}
        icon={<IconRefresh aria-hidden="true" className="size-4" />}
        onClick={() => chart.timeScale().fitContent()}
      />
    </div>
  );
}
