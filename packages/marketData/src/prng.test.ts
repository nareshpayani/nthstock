import { describe, expect, it } from 'vitest';
import {
  hashSeed,
  mulberry32,
  mulberry32Randomizer,
  pick,
  randomBetween,
  randomInt,
  randomNormal,
} from './prng.js';

const take = (rng: () => number, n: number) => Array.from({ length: n }, () => rng());

describe('mulberry32', () => {
  it('gives identical first 1,000 values for the same seed', () => {
    expect(take(mulberry32(42), 1000)).toEqual(take(mulberry32(42), 1000));
  });

  it('gives different streams for different seeds', () => {
    expect(take(mulberry32(1), 10)).not.toEqual(take(mulberry32(2), 10));
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const values = take(mulberry32(7), 10_000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe('hashSeed', () => {
  it('is stable and sensitive to every part', () => {
    expect(hashSeed('INFY', '1D', 3)).toBe(hashSeed('INFY', '1D', 3));
    expect(hashSeed('INFY', '1D')).not.toBe(hashSeed('INFY', '1W'));
    expect(hashSeed('x')).toBeGreaterThanOrEqual(0);
  });
});

describe('helpers', () => {
  it('randomInt stays within inclusive bounds and hits both ends', () => {
    const rng = mulberry32(3);
    const values = new Set(Array.from({ length: 500 }, () => randomInt(rng, 1, 3)));
    expect([...values].sort()).toEqual([1, 2, 3]);
  });

  it('randomBetween stays in range', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 200; i += 1) {
      const v = randomBetween(rng, 5, 6);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(6);
    }
  });

  it('randomNormal has mean ≈ 0 and variance ≈ 1', () => {
    const rng = mulberry32(5);
    const values = Array.from({ length: 20_000 }, () => randomNormal(rng));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it('pick chooses from the list and rejects an empty one', () => {
    const rng = mulberry32(6);
    expect(['a', 'b']).toContain(pick(rng, ['a', 'b']));
    expect(() => pick(rng, [])).toThrow(RangeError);
  });
});

describe('mulberry32Randomizer', () => {
  it('reseeds with a number or an array of numbers', () => {
    const randomizer = mulberry32Randomizer(1);
    randomizer.seed(9);
    const a = randomizer.next();
    randomizer.seed(9);
    expect(randomizer.next()).toBe(a);
    randomizer.seed([1, 2, 3]);
    const b = randomizer.next();
    randomizer.seed([1, 2, 3]);
    expect(randomizer.next()).toBe(b);
  });
});
