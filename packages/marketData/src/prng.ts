/**
 * Seeded randomness for every piece of mock market data (ADR 0004: randomness is injected). The
 * same seed always gives the same symbol master, ticks, candles and depth, in Node and the browser.
 */

/** A source of uniform numbers in [0, 1). */
export type Rng = () => number;

const UINT32 = 4294967296;

/** mulberry32: a small, fast 32-bit PRNG. Good enough for simulation, never for security. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/** FNV-1a over the parts, so every symbol, range and day gets its own stable sub-seed. */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** An integer in [min, max], both inclusive. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** A float in [min, max). */
export function randomBetween(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** A standard normal draw (Box–Muller). */
export function randomNormal(rng: Rng): number {
  // 1 - rng() is in (0, 1], so the log is finite.
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A uniformly chosen element. Throws on an empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new RangeError('pick() needs a non-empty list');
  return item;
}

/**
 * A randomizer for `@faker-js/faker` backed by mulberry32, so faker draws from the same seeded
 * stream as the rest of the mock data. Structurally matches faker's `Randomizer` interface.
 */
export function mulberry32Randomizer(seed: number): {
  next(): number;
  seed(s: number | number[]): void;
} {
  let rng = mulberry32(seed);
  return {
    next: () => rng(),
    seed: (s) => {
      rng = mulberry32(Array.isArray(s) ? hashSeed(...s) : s);
    },
  };
}
