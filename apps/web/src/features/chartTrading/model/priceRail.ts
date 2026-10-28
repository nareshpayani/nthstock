/** Minor ticks on the price rail sit at least this far apart, so the ruler reads as a texture. */
export const RAIL_MIN_GAP = 6;
/** Every fifth minor tick is longer, a ruler's half-step. */
export const RAIL_MAJOR_EVERY = 5;

/**
 * The price step between the rail's minor ticks (SPEC-CR-1 §4.2): the smallest 1, 2 or 5 × 10ⁿ
 * paise, and never less than the instrument's tick, that keeps ticks `RAIL_MIN_GAP` px apart.
 */
export function railStep(paisePerPx: number, tickSize: number): number {
  if (!Number.isFinite(tickSize) || !(tickSize > 0)) return railStep(paisePerPx, 1);
  if (!(paisePerPx > 0) || !Number.isFinite(paisePerPx)) return Math.max(tickSize, 1);
  const wanted = Math.max(paisePerPx * RAIL_MIN_GAP, tickSize, 1);
  let decade = 10 ** Math.floor(Math.log10(wanted));
  for (;;) {
    for (const factor of [1, 2, 5]) {
      if (factor * decade >= wanted) return factor * decade;
    }
    decade *= 10;
  }
}

export type RailTick = { y: number; major: boolean };

/**
 * The rail's ticks between two prices, top to bottom, as pane y coordinates. `toY` is the chart's
 * price-to-coordinate mapping; a price it cannot place is skipped.
 */
export function railTicks(
  high: number,
  low: number,
  step: number,
  toY: (price: number) => number | null,
): RailTick[] {
  const ticks: RailTick[] = [];
  if (!(step > 0) || !(high > low)) return ticks;
  const first = Math.floor(high / step);
  const last = Math.ceil(low / step);
  // A runaway range (a broken scale) draws nothing rather than thousands of ticks.
  if (first - last > 2000) return ticks;
  for (let index = first; index >= last; index -= 1) {
    const y = toY(index * step);
    if (y === null || !Number.isFinite(y)) continue;
    ticks.push({ y, major: index % RAIL_MAJOR_EVERY === 0 });
  }
  return ticks;
}
