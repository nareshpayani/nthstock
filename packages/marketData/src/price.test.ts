import { describe, expect, it } from 'vitest';
import {
  ceilToTick,
  changeBasisPoints,
  circuitBand,
  clamp,
  floorToTick,
  roundToTick,
} from './price.js';

describe('tick rounding', () => {
  it('rounds, floors and ceils to the 5-paise tick', () => {
    expect(roundToTick(12_342)).toBe(12_340);
    expect(roundToTick(12_343)).toBe(12_345);
    expect(floorToTick(12_349)).toBe(12_345);
    expect(ceilToTick(12_341)).toBe(12_345);
  });

  it('never rounds below one tick and supports other ticks', () => {
    expect(roundToTick(1)).toBe(5);
    expect(roundToTick(-40)).toBe(5);
    expect(roundToTick(2_500_049.6, 1)).toBe(2_500_050);
  });
});

describe('circuitBand', () => {
  it('is ±20% of the previous close, on tick and inside the band', () => {
    expect(circuitBand(100_000)).toEqual({ lower: 80_000, upper: 120_000 });
    const band = circuitBand(12_345);
    expect(band.lower % 5).toBe(0);
    expect(band.upper % 5).toBe(0);
    expect(band.lower).toBeGreaterThanOrEqual(12_345 * 0.8);
    expect(band.upper).toBeLessThanOrEqual(12_345 * 1.2);
  });

  it('keeps the lower limit at least one tick', () => {
    expect(circuitBand(5).lower).toBe(5);
  });
});

describe('changeBasisPoints', () => {
  it('returns integer basis points and 0 for a zero base', () => {
    expect(changeBasisPoints(101_000, 100_000)).toBe(100);
    expect(changeBasisPoints(99_000, 100_000)).toBe(-100);
    expect(changeBasisPoints(100_333, 100_000)).toBe(33);
    expect(changeBasisPoints(5, 0)).toBe(0);
  });
});

describe('clamp', () => {
  it('bounds a value', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
