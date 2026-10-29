import type { BarData, LineData, UTCTimestamp } from 'lightweight-charts';

/** How long a tick takes to glide to its new price, ms. Under a 250 ms tick, so glides never stack. */
export const GLIDE_MS = 160;

type Point = LineData<UTCTimestamp> | BarData<UTCTimestamp>;

/** The price a point ends at: a line's value, a bar's close. */
export function closeOf(point: Point): number {
  return 'close' in point ? point.close : point.value;
}

/**
 * The point part way through a glide from `fromClose` to `to` (A16): the same bar with its close
 * eased toward the new one. A bar's high and low already hold the new close, and the old close sat
 * inside them, so every in-between close stays inside the bar.
 */
export function glidePoint(to: Point, fromClose: number, progress: number): Point {
  const eased = 1 - (1 - Math.min(1, Math.max(0, progress))) ** 3;
  const close = fromClose + (closeOf(to) - fromClose) * eased;
  return 'close' in to ? { ...to, close } : { ...to, value: close };
}
