import type { Candle } from '@nthstock/contracts';

/**
 * Deterministic candles for tests and stories: `count` bars from `start`, `stepMs` apart, closes
 * walking from `first` by `step` (integers, paise or hundredths of a point).
 */
export function makeCandles({
  count,
  start = '2026-09-25T03:45:00.000Z',
  stepMs = 60_000,
  first = 2_500_000,
  step = 150,
}: {
  count: number;
  start?: string;
  stepMs?: number;
  first?: number;
  step?: number;
}): Candle[] {
  const t0 = Date.parse(start);
  return Array.from({ length: count }, (_, i) => {
    // A gentle zig-zag so the series is not a straight line.
    const o = first + i * step + (i % 3 === 0 ? -step : 0);
    const c = first + (i + 1) * step;
    return {
      t: new Date(t0 + i * stepMs).toISOString(),
      o,
      h: Math.max(o, c) + Math.abs(step),
      l: Math.min(o, c) - Math.abs(step),
      c,
      v: 1_000 + i,
    };
  });
}
