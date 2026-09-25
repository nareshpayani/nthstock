import { describe, expect, it } from 'vitest';
import { circuitBand } from './price.js';
import { mulberry32 } from './prng.js';
import { SECTORS, SECTOR_GBM } from './sectors.js';
import {
  SESSION_MINUTES,
  applyTick,
  createPriceState,
  gbmStep,
  rollSession,
  tickYears,
} from './ticks.js';

const ONE_SECOND = tickYears(1000);
const TICKS_PER_DAY = SESSION_MINUTES * 60;

describe('gbmStep', () => {
  it('follows exp((μ − σ²/2)dt + σ√dt·z)', () => {
    const params = { drift: 0.1, volatility: 0.2 };
    expect(gbmStep(100, params, 1, 0)).toBeCloseTo(100 * Math.exp(0.08), 10);
    expect(gbmStep(100, params, 1, 1)).toBeCloseTo(100 * Math.exp(0.28), 10);
    expect(gbmStep(100, params, 1, 1)).toBeGreaterThan(gbmStep(100, params, 1, -1));
  });
});

describe('applyTick', () => {
  it('never breaches the ±20% band and every price is an integer multiple of 5 over a simulated day', () => {
    const rng = mulberry32(11);
    // Absurd volatility so the band is actually tested, plus every real sector setting.
    const settings = [
      { drift: 0, volatility: 40 },
      { drift: 5, volatility: 25 },
      ...SECTORS.map((s) => SECTOR_GBM[s]),
    ];
    for (const params of settings) {
      const state = createPriceState(123_455);
      const band = circuitBand(state.prevClose);
      let hitLimit = false;
      const violations: number[] = [];
      for (let i = 0; i < TICKS_PER_DAY; i += 1) {
        applyTick(state, { params, dtYears: ONE_SECOND, rng, volumePerTick: 10 });
        const { ltp } = state;
        if (!Number.isInteger(ltp) || ltp % 5 !== 0 || ltp < band.lower || ltp > band.upper) {
          violations.push(ltp);
        }
        if (ltp === band.lower || ltp === band.upper) hitLimit = true;
      }
      expect(violations).toEqual([]);
      expect(state.high).toBeLessThanOrEqual(band.upper);
      expect(state.low).toBeGreaterThanOrEqual(band.lower);
      expect(state.high % 5).toBe(0);
      expect(state.low % 5).toBe(0);
      if (params.volatility >= 25) expect(hitLimit).toBe(true);
    }
  });

  it('tracks high, low and volume', () => {
    const state = createPriceState(100_000);
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i += 1) {
      applyTick(state, {
        params: { drift: 0, volatility: 2 },
        dtYears: ONE_SECOND,
        rng,
        volumePerTick: 4,
      });
      expect(state.low).toBeLessThanOrEqual(state.ltp);
      expect(state.high).toBeGreaterThanOrEqual(state.ltp);
    }
    expect(state.volume).toBeGreaterThanOrEqual(500 * 2);
    expect(state.volume).toBeLessThanOrEqual(500 * 6);
  });

  it('leaves volume alone without a volume rate and supports a custom tick', () => {
    const state = createPriceState(2_500_000);
    applyTick(state, {
      params: { drift: 0, volatility: 0.5 },
      dtYears: ONE_SECOND,
      rng: mulberry32(1),
      tick: 1,
    });
    expect(state.volume).toBe(0);
    expect(Number.isInteger(state.ltp)).toBe(true);
  });
});

describe('rollSession', () => {
  it('makes the last price the new previous close and resets the day', () => {
    const state = createPriceState(10_000, 10_100);
    state.ltp = 10_500;
    state.high = 10_600;
    state.volume = 99;
    rollSession(state);
    expect(state).toEqual({
      prevClose: 10_500,
      open: 10_500,
      high: 10_500,
      low: 10_500,
      ltp: 10_500,
      volume: 0,
      raw: 10_500,
    });
  });
});
