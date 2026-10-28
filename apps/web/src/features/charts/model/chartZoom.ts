/** A visible span of bars, in the chart's logical (bar index) units. */
export type LogicalRange = { from: number; to: number };

/** How much one zoom step narrows (zoom in) or widens (zoom out) the visible bars. */
export const ZOOM_STEP = 1.5;
/** Zooming in stops at this many bars on screen. */
const MIN_BARS = 10;
/** Zooming out stops at this many bars on screen. */
const MAX_BARS = 2_000;

/**
 * The visible range after `steps` zoom steps (positive zooms in), keeping the right edge, the latest
 * bar, where it is, as the time-axis zoom of TradingView does (NSTOCK-0437).
 */
export function zoomedLogicalRange(range: LogicalRange, steps: number): LogicalRange {
  const span = range.to - range.from;
  // Never past the limits, and never the wrong way: zoom in on fewer than ten bars stays put.
  const next = Math.min(
    Math.max(span, MAX_BARS),
    Math.max(Math.min(span, MIN_BARS), span / ZOOM_STEP ** steps),
  );
  return { from: range.to - next, to: range.to };
}
