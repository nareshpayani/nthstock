/**
 * Precision while dragging a line (A10). Fine control: the further the thumb slides sideways from
 * where it pressed, the slower the price follows it, like scrubbing video on iOS. Edge scroll:
 * holding a line near the top or bottom of the plot keeps scrolling the price range that way, so a
 * price off screen can still be set.
 */

/** Sideways px for the price to follow at half speed (a quarter at three times this). */
export const FINE_PX = 80;
/** The slowest the price follows the thumb. */
const MIN_FACTOR = 0.2;
/** Below this the loupe says the drag is fine. */
export const FINE_SHOWN_BELOW = 0.75;

/** How much of a vertical move becomes price movement, from the sideways distance. */
export function fineFactor(sideways: number): number {
  return Math.max(MIN_FACTOR, 1 / (1 + Math.abs(sideways) / FINE_PX));
}

/** Where the drag is, in pane px, after the thumb moves from `lastY` to `y` at this factor. */
export function fineY(effectiveY: number, lastY: number, y: number, factor: number): number {
  return effectiveY + (y - lastY) * factor;
}

/** A held line this close (px) to the plot's top or bottom edge scrolls the price range. */
export const EDGE_PX = 28;
/** At the very edge the range moves this share of its height per frame. */
const EDGE_SPEED = 0.012;

/**
 * The share of the price range to scroll this frame for a thumb at `y` in a plot `height` px tall:
 * positive moves the range up (higher prices come in from the top), negative down, 0 away from
 * the edges. It speeds up the nearer the edge.
 */
export function edgeScroll(y: number, height: number): number {
  if (height <= EDGE_PX * 2) return 0;
  if (y < EDGE_PX) return EDGE_SPEED * (1 - Math.max(0, y) / EDGE_PX);
  if (y > height - EDGE_PX) return -EDGE_SPEED * (1 - Math.max(0, height - y) / EDGE_PX);
  return 0;
}
