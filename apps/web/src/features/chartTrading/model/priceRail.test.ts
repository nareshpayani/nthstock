import { describe, expect, it } from 'vitest';
import { railStep, railTicks } from './priceRail';

describe('price rail (CR-T06, SPEC-CR-1 §4.2)', () => {
  it('picks the smallest 1, 2 or 5 step that keeps ticks 6 px apart, never under the tick', () => {
    // 50 paise per px: 300 paise wanted, so ₹5.00.
    expect(railStep(50, 5)).toBe(500);
    expect(railStep(10, 5)).toBe(100);
    expect(railStep(0.1, 5)).toBe(5);
    expect(railStep(160, 5)).toBe(1000);
    expect(railStep(170, 5)).toBe(2000);
    expect(railStep(0, 5)).toBe(5);
  });

  it('places a tick on every step between two prices, with every fifth one major', () => {
    const toY = (price: number) => (160_000 - price) / 50;
    const ticks = railTicks(160_000, 157_000, 500, toY);
    expect(ticks.map((tick) => tick.y)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.y)).toEqual([0, 50]);
  });

  it('draws nothing for an empty or runaway range', () => {
    const toY = (price: number) => price;
    expect(railTicks(100, 200, 5, toY)).toEqual([]);
    expect(railTicks(1e9, 0, 5, toY)).toEqual([]);
  });
});
