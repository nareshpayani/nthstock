/**
 * The chart's share of the screen height on a phone, clamp(220 px, 40% of the height, 480 px)
 * (SPEC-CR-1 §6.1). Shared by the instrument page and its loading skeleton, so they match.
 */
export function phoneChartHeight(viewportHeight: number): number {
  return Math.min(480, Math.max(220, Math.round(viewportHeight * 0.4)));
}

/** The chart's height on wider screens, in px. */
export const DESKTOP_CHART_HEIGHT = 320;
