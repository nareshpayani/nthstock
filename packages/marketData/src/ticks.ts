import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import { circuitBand, clamp, roundToTick } from './price.js';
import { randomNormal, type Rng } from './prng.js';
import type { GbmParams } from './sectors.js';

export const TRADING_DAYS_PER_YEAR = 252;
/** Normal NSE session length, 9:15–15:30 IST. */
export const SESSION_MINUTES = 375;
export const SESSION_SECONDS_PER_YEAR = TRADING_DAYS_PER_YEAR * SESSION_MINUTES * 60;

/** Years of trading time covered by one tick of `intervalMs`. */
export function tickYears(intervalMs: number): number {
  return intervalMs / 1000 / SESSION_SECONDS_PER_YEAR;
}

/** One geometric Brownian motion step on an unrounded price, given a standard normal draw `z`. */
export function gbmStep(price: number, params: GbmParams, dtYears: number, z: number): number {
  const { drift, volatility } = params;
  return (
    price *
    Math.exp(
      (drift - (volatility * volatility) / 2) * dtYears + volatility * Math.sqrt(dtYears) * z,
    )
  );
}

/**
 * The session state of one instrument. Every published field is integer paise (or a count);
 * `raw` is the simulator's unrounded model price, which never leaves the package.
 */
export type PriceState = {
  prevClose: number;
  open: number;
  high: number;
  low: number;
  ltp: number;
  volume: number;
  raw: number;
};

export function createPriceState(prevClose: number, open: number = prevClose): PriceState {
  return { prevClose, open, high: open, low: open, ltp: open, volume: 0, raw: open };
}

/** Starts a new session: yesterday's last price becomes the previous close. */
export function rollSession(state: PriceState): void {
  state.prevClose = state.ltp;
  state.open = state.ltp;
  state.high = state.ltp;
  state.low = state.ltp;
  state.volume = 0;
  state.raw = state.ltp;
}

export type TickOptions = {
  params: GbmParams;
  dtYears: number;
  rng: Rng;
  /** Average shares traded per tick; each tick adds 0.5–1.5× this. */
  volumePerTick?: number;
  tick?: number;
};

/**
 * Advances a price one GBM step in place. The LTP is rounded to the tick and held inside the ±20%
 * circuit band of the previous close; the model price is clamped to the band too so it can't wander
 * off and pin the LTP to a limit for the rest of the session.
 */
export function applyTick(state: PriceState, options: TickOptions): void {
  const tick = options.tick ?? TICK_SIZE_PAISE;
  const band = circuitBand(state.prevClose, tick);
  const next = gbmStep(state.raw, options.params, options.dtYears, randomNormal(options.rng));
  state.raw = clamp(next, band.lower, band.upper);
  state.ltp = clamp(roundToTick(state.raw, tick), band.lower, band.upper);
  if (state.ltp > state.high) state.high = state.ltp;
  if (state.ltp < state.low) state.low = state.ltp;
  const perTick = options.volumePerTick ?? 0;
  if (perTick > 0) state.volume += Math.max(1, Math.round(perTick * (0.5 + options.rng())));
}
