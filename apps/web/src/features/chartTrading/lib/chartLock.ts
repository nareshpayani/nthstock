import type { ChartOptions, CrosshairMode, DeepPartial, IChartApi } from 'lightweight-charts';

/** `CrosshairMode.Hidden`. A type-only import keeps the library out of this feature's chunk. */
const CROSSHAIR_HIDDEN = 2 as CrosshairMode;

const LOCKED: DeepPartial<ChartOptions> = {
  crosshair: { mode: CROSSHAIR_HIDDEN },
  handleScroll: false,
  handleScale: false,
};

/**
 * Hands the gesture to a line drag (SPEC-CR-1 §5.1): hides the crosshair and turns off the chart's
 * own scroll and scale handling until the returned function puts them back. Calling that function
 * more than once restores only once.
 */
export function lockChart(chart: IChartApi): () => void {
  const { crosshair, handleScroll, handleScale } = chart.options();
  chart.applyOptions(LOCKED);
  chart.clearCrosshairPosition();
  let locked = true;
  return () => {
    if (!locked) return;
    locked = false;
    chart.applyOptions({ crosshair: { mode: crosshair.mode }, handleScroll, handleScale });
  };
}
