/**
 * Price-axis zoom (NSTOCK-0436): dragging along the price axis stretches or squeezes the price
 * range around its middle, the way dragging the time axis does for time. Dragging down widens the
 * range (prices squeeze together), dragging up narrows it (prices spread out), as in TradingView
 * and Kite. The scale is exponential, so equal drags give equal zoom steps at any level.
 */

export type PriceRange = { from: number; to: number };

/** Pixels of drag for the range to grow (or shrink) by a factor of e. */
export const PRICE_ZOOM_PX = 160;
/** How far one drag can zoom from where it started, either way. */
const MAX_FACTOR = 20;

/**
 * The range after a drag of `dy` px (positive is down) from where the press began. Its foot stays
 * at `floor` or above (a tick), so a zoom out never shows prices of zero or below.
 */
export function zoomedPriceRange(range: PriceRange, dy: number, floor: number): PriceRange {
  const factor = Math.min(MAX_FACTOR, Math.max(1 / MAX_FACTOR, Math.exp(dy / PRICE_ZOOM_PX)));
  const middle = (range.from + range.to) / 2;
  const half = ((range.to - range.from) / 2) * factor;
  return { from: Math.max(floor, middle - half), to: middle + half };
}
