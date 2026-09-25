import { describe, expect, it } from 'vitest';
import { aggregateValue, computeIndexLevel } from './indexLevels.js';
import { mulberry32, randomNormal } from './prng.js';

describe('computeIndexLevel', () => {
  it('equals the base level at base prices and scales with aggregate value', () => {
    const base = [
      { weight: 10, price: 1_000 },
      { weight: 5, price: 4_000 },
    ];
    const baseValue = aggregateValue(base);
    expect(baseValue).toBe(30_000);
    expect(computeIndexLevel(2_500_000, baseValue, base)).toBe(2_500_000);
    const doubled = base.map((c) => ({ ...c, price: c.price * 2 }));
    expect(computeIndexLevel(2_500_000, baseValue, doubled)).toBe(5_000_000);
  });

  it('returns the base level for an empty base', () => {
    expect(computeIndexLevel(1_000, 0, [])).toBe(1_000);
  });

  it('moves in the same direction as the weighted constituent change', () => {
    const rng = mulberry32(8);
    const constituents = Array.from({ length: 50 }, () => ({
      weight: Math.round(1e6 + rng() * 1e9),
      price: 5 * Math.round(2_000 + rng() * 400_000),
    }));
    const baseValue = aggregateValue(constituents);
    let checked = 0;
    for (let trial = 0; trial < 500; trial += 1) {
      const moved = constituents.map((c) => ({
        ...c,
        price: 5 * Math.max(1, Math.round((c.price * (1 + 0.01 * randomNormal(rng))) / 5)),
      }));
      const weightedChange = moved.reduce(
        (sum, c, i) => sum + c.weight * (c.price - (constituents[i]?.price ?? 0)),
        0,
      );
      const levelChange = computeIndexLevel(2_500_000, baseValue, moved) - 2_500_000;
      // Skip changes too small to move the level by a hundredth of a point.
      if (Math.abs(weightedChange / baseValue) < 1e-6) continue;
      expect(Math.sign(levelChange)).toBe(Math.sign(weightedChange));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(450);
  });
});
