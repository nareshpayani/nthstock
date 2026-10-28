/**
 * The chart's share of the screen height on a phone, clamp(220 px, 40% of the height, 480 px)
 * (SPEC-CR-1 §6.1). Shared by the instrument page and its loading skeleton, so they match.
 */
export function phoneChartHeight(viewportHeight: number): number {
  return Math.min(480, Math.max(220, Math.round(viewportHeight * 0.4)));
}

/** The app bar (56 px) and the dock (position strip and trade bar, about 112 px) in landscape. */
const LANDSCAPE_CHROME = 168;

/**
 * In landscape the chart fills the height between the app bar and the dock (SPEC-CR-1 §6.2), and
 * never drops under 160 px.
 */
export function landscapeChartHeight(viewportHeight: number): number {
  return Math.max(160, viewportHeight - LANDSCAPE_CHROME);
}

/** The chart's height on wider screens, in px. */
export const DESKTOP_CHART_HEIGHT = 320;
