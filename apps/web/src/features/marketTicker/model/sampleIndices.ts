/**
 * SAMPLE index values for the header and dashboard until live data arrives in E4 (T-043, T-055).
 * Levels and changes are in hundredths of a point; changes in basis points. Not real market data.
 */
export type SampleIndex = {
  symbol: string;
  name: string;
  level: number;
  change: number;
  changeBasisPoints: number;
  /** A short sample intraday series for sparklines. */
  series: readonly number[];
};

function series(start: number, drift: number, wobble: number, seed: number): number[] {
  // Deterministic wiggle (no Math.random) so screenshots and tests are stable.
  return Array.from({ length: 48 }, (_, i) => {
    const wave = Math.sin((i + seed) / 3) * wobble + Math.sin((i * 7 + seed) / 5) * (wobble / 2);
    return Math.round(start + drift * i + wave);
  });
}

export const sampleIndices: readonly SampleIndex[] = [
  {
    symbol: 'NIFTY 50',
    name: 'NIFTY 50',
    level: 2541860,
    change: 21245,
    changeBasisPoints: 84,
    series: series(2520615, 450, 2600, 1),
  },
  {
    symbol: 'SENSEX',
    name: 'SENSEX',
    level: 8309215,
    change: -9970,
    changeBasisPoints: -12,
    series: series(8319185, -210, 6500, 4),
  },
  {
    symbol: 'NIFTY BANK',
    name: 'NIFTY BANK',
    level: 5612040,
    change: 30810,
    changeBasisPoints: 55,
    series: series(5581230, 640, 5200, 7),
  },
  {
    symbol: 'NIFTY IT',
    name: 'NIFTY IT',
    level: 3574525,
    change: -25015,
    changeBasisPoints: -69,
    series: series(3599540, -520, 3800, 2),
  },
  {
    symbol: 'NIFTY MIDCAP 100',
    name: 'NIFTY MIDCAP 100',
    level: 5898330,
    change: 0,
    changeBasisPoints: 0,
    series: series(5898330, 0, 4200, 9),
  },
];

/** A longer SAMPLE series (a year of weekly points) for the dashboard index chart. */
export const sampleNiftyYear: readonly number[] = Array.from({ length: 52 }, (_, i) => {
  const trend = 2180000 + i * 6900;
  const swing = Math.sin(i / 4) * 52000 + Math.sin(i / 1.7) * 21000;
  return Math.round(trend + swing);
});
