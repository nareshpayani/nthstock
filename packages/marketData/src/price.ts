import { TICK_SIZE_PAISE } from '@nthstock/contracts';

/** Circuit band as a percentage of the previous close (±20%). */
export const CIRCUIT_BAND_PCT = 20;

/** Nearest multiple of `tick` (default 5 paise), never below one tick. Returns integer paise. */
export function roundToTick(value: number, tick: number = TICK_SIZE_PAISE): number {
  return Math.max(tick, Math.round(value / tick) * tick);
}

/** Largest multiple of `tick` that is ≤ value. */
export function floorToTick(value: number, tick: number = TICK_SIZE_PAISE): number {
  return Math.floor(value / tick) * tick;
}

/** Smallest multiple of `tick` that is ≥ value. */
export function ceilToTick(value: number, tick: number = TICK_SIZE_PAISE): number {
  return Math.ceil(value / tick) * tick;
}

export type CircuitBand = { lower: number; upper: number };

/** The ±20% price band from the previous close, both ends on tick and inside the band. */
export function circuitBand(prevClose: number, tick: number = TICK_SIZE_PAISE): CircuitBand {
  return {
    lower: Math.max(tick, ceilToTick((prevClose * (100 - CIRCUIT_BAND_PCT)) / 100, tick)),
    upper: floorToTick((prevClose * (100 + CIRCUIT_BAND_PCT)) / 100, tick),
  };
}

/** Change from the previous close in basis points (1% = 100 bp), rounded to an integer. */
export function changeBasisPoints(ltp: number, prevClose: number): number {
  if (prevClose <= 0) return 0;
  return Math.round(((ltp - prevClose) * 10_000) / prevClose);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
