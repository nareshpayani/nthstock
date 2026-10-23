import { TRAILING_STOP_MESSAGES, type Trail, type TrailingStopParams } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  armedState,
  modifyTrailingStop,
  previewTrailingStop,
  stepTrailingStop,
  stopFromWatermark,
  validateStopPrice,
  validateTrailingStop,
  type TrailingStopState,
} from './trailingStop.js';

const rupees = (amount: number): Trail => ({ unit: 'AMOUNT', amount });
const percent = (basisPoints: number): Trail => ({ unit: 'PERCENT', basisPoints });

/** Runs a stop through a price path and returns every state after each tick. */
function run(start: TrailingStopState, prices: number[]) {
  let state = start;
  let triggers = 0;
  const states = prices.map((ltp) => {
    const step = stepTrailingStop(state, ltp);
    if (step.triggered) triggers += 1;
    state = step.state;
    return state;
  });
  return { states, final: state, triggers };
}

const long = (trail: Trail, activationPrice: number | null = null) =>
  armedState({ trail, activationPrice }, 'LONG');
const short = (trail: Trail, activationPrice: number | null = null) =>
  armedState({ trail, activationPrice }, 'SHORT');

describe('stepTrailingStop: long (SPEC-TFC-1 §6.3)', () => {
  it('trails at once without an activation price, a trail below the first price', () => {
    const { final } = run(long(rupees(10_00)), [1_500_00]);
    expect(final).toMatchObject({
      status: 'TRAILING',
      watermarkPrice: 1_500_00,
      stopPrice: 1_490_00,
    });
  });

  it('waits ARMED until the price reaches the activation price', () => {
    const { states } = run(long(rupees(10_00), 1_510_00), [1_500_00, 1_509_95, 1_510_00]);
    expect(states.map((s) => s.status)).toEqual(['ARMED', 'ARMED', 'TRAILING']);
    expect(states[2]).toMatchObject({ watermarkPrice: 1_510_00, stopPrice: 1_500_00 });
  });

  it('ratchets up with new highs and never moves down', () => {
    const { states } = run(long(rupees(10_00)), [1_500_00, 1_520_00, 1_515_00, 1_530_00]);
    expect(states.map((s) => s.stopPrice)).toEqual([1_490_00, 1_510_00, 1_510_00, 1_520_00]);
    expect(states.map((s) => s.watermarkPrice)).toEqual([1_500_00, 1_520_00, 1_520_00, 1_530_00]);
  });

  it('triggers at the stop, not a paisa before', () => {
    const { states, triggers } = run(long(rupees(10_00)), [1_500_00, 1_490_05, 1_490_00]);
    expect(states.map((s) => s.status)).toEqual(['TRAILING', 'TRAILING', 'TRIGGERED']);
    expect(triggers).toBe(1);
  });

  it('triggers once on a gap through the stop and ignores later ticks', () => {
    const { states, triggers } = run(long(rupees(10_00)), [1_500_00, 1_400_00, 1_300_00, 1_600_00]);
    expect(states.map((s) => s.status)).toEqual([
      'TRAILING',
      'TRIGGERED',
      'TRIGGERED',
      'TRIGGERED',
    ]);
    expect(states[3]).toMatchObject({ stopPrice: 1_490_00, watermarkPrice: 1_500_00 });
    expect(triggers).toBe(1);
  });

  it('floors a percent trail to the tick below the price', () => {
    // 1.5% of ₹1,234.55 is ₹18.51825, so the stop is ₹1,216.03175, floored to ₹1,216.00.
    const { final } = run(long(percent(150)), [1_234_55]);
    expect(final.stopPrice).toBe(1_216_00);
  });

  it('leaves terminal statuses alone', () => {
    for (const status of ['EXECUTED', 'CANCELLED', 'REJECTED', 'PENDING_ENTRY'] as const) {
      const state = { ...long(rupees(5_00)), status };
      expect(stepTrailingStop(state, 1_000_00)).toEqual({ state, triggered: false });
    }
  });
});

describe('stepTrailingStop: short mirrors long', () => {
  it('trails above the lowest price, ratchets down, ceils to the tick and triggers at or above', () => {
    const { states, triggers } = run(short(percent(150)), [1_234_55, 1_200_00, 1_210_00, 1_218_00]);
    // 1.5% above ₹1,234.55 is ₹1,253.06825, ceiled to ₹1,253.10; above ₹1,200 it is ₹1,218.00.
    expect(states.map((s) => s.stopPrice)).toEqual([1_253_10, 1_218_00, 1_218_00, 1_218_00]);
    expect(states.map((s) => s.status)).toEqual(['TRAILING', 'TRAILING', 'TRAILING', 'TRIGGERED']);
    expect(triggers).toBe(1);
  });

  it('activates when the price falls to the activation price', () => {
    const { states } = run(short(rupees(5_00), 990_00), [1_000_00, 990_00]);
    expect(states.map((s) => s.status)).toEqual(['ARMED', 'TRAILING']);
    expect(states[1]?.stopPrice).toBe(995_00);
  });
});

/** Mulberry32: a small seeded generator, so the randomized runs below repeat exactly. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('stepTrailingStop invariants over random price paths', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i', (seed) => {
    const random = seeded(seed);
    for (const direction of ['LONG', 'SHORT'] as const) {
      const trail =
        random() < 0.5
          ? rupees(5 * (1 + Math.floor(random() * 400)))
          : percent(10 + Math.floor(random() * 1_990));
      let price = 1_000_00 + 5 * Math.floor(random() * 20_000);
      let state = armedState({ trail, activationPrice: null }, direction);
      let triggers = 0;
      for (let tick = 0; tick < 500; tick += 1) {
        price = Math.max(5, price + 5 * Math.round((random() - 0.5) * 400));
        const before = state;
        const step = stepTrailingStop(state, price);
        state = step.state;
        if (step.triggered) triggers += 1;
        if (state.stopPrice !== null) {
          // On the tick, and the stop never loosens.
          expect(state.stopPrice % 5).toBe(0);
          if (before.stopPrice !== null) {
            if (direction === 'LONG')
              expect(state.stopPrice).toBeGreaterThanOrEqual(before.stopPrice);
            else expect(state.stopPrice).toBeLessThanOrEqual(before.stopPrice);
          }
        }
        // Still trailing means the price has not reached the stop.
        if (state.status === 'TRAILING' && state.stopPrice !== null) {
          if (direction === 'LONG') expect(price).toBeGreaterThan(state.stopPrice);
          else expect(price).toBeLessThan(state.stopPrice);
        }
      }
      expect(triggers).toBeLessThanOrEqual(1);
      expect(triggers === 1).toBe(state.status === 'TRIGGERED');
    }
  });
});

describe('previewTrailingStop', () => {
  const params = (trail: Trail, activationPrice: number | null = null) => ({
    trail,
    activationPrice,
  });

  it('equals the first engine step for a stop that trails at once', () => {
    for (const trail of [rupees(12_50), percent(75)]) {
      for (const direction of ['LONG', 'SHORT'] as const) {
        const first = stepTrailingStop(armedState(params(trail), direction), 1_523_45).state;
        expect(previewTrailingStop(params(trail), 1_523_45, direction)).toEqual({
          status: 'TRAILING',
          stopPrice: first.stopPrice,
          activatesImmediately: false,
        });
      }
    }
  });

  it('shows the stop at activation while armed', () => {
    expect(previewTrailingStop(params(rupees(10_00), 1_600_00), 1_500_00, 'LONG')).toEqual({
      status: 'ARMED',
      stopPrice: 1_590_00,
      activatesImmediately: false,
    });
  });

  it('says an activation price already passed activates immediately', () => {
    expect(previewTrailingStop(params(rupees(10_00), 1_400_00), 1_500_00, 'LONG')).toEqual({
      status: 'TRAILING',
      stopPrice: 1_490_00,
      activatesImmediately: true,
    });
  });
});

describe('modifyTrailingStop (SPEC-TFC-1 §6.5)', () => {
  const trailing = run(long(rupees(10_00)), [1_500_00, 1_550_00]).final; // stop ₹1,540

  it('takes a new trail from the watermark, widening as well as tightening', () => {
    expect(modifyTrailingStop(trailing, { trail: rupees(30_00) })).toMatchObject({
      stopPrice: 1_520_00,
      watermarkPrice: 1_550_00,
      trail: rupees(30_00),
    });
    expect(modifyTrailingStop(trailing, { trail: percent(20) }).stopPrice).toBe(1_546_90);
  });

  it('turns a dragged stop price into a rupee trail from the watermark', () => {
    const moved = modifyTrailingStop(trailing, { stopPrice: 1_535_00 });
    expect(moved).toMatchObject({ trail: rupees(15_00), stopPrice: 1_535_00 });
    // The widened stop is the new baseline: the next tick does not snap it back.
    expect(stepTrailingStop(moved, 1_545_00).state.stopPrice).toBe(1_535_00);
  });

  it('mirrors a drag for a short position', () => {
    const shortTrailing = run(short(rupees(10_00)), [1_500_00]).final; // stop ₹1,510
    expect(modifyTrailingStop(shortTrailing, { stopPrice: 1_520_00 })).toMatchObject({
      trail: rupees(20_00),
      stopPrice: 1_520_00,
    });
  });

  it('refuses a dragged stop on the wrong side of the watermark', () => {
    expect(() => modifyTrailingStop(trailing, { stopPrice: 1_550_00 })).toThrow(
      TRAILING_STOP_MESSAGES.stopWouldTrigger,
    );
  });

  it('only stores the trail while the stop is armed', () => {
    const armed = long(rupees(10_00), 1_600_00);
    expect(modifyTrailingStop(armed, { trail: rupees(20_00) })).toEqual({
      ...armed,
      trail: rupees(20_00),
    });
    expect(modifyTrailingStop(armed, { stopPrice: 1_590_00 }).trail).toEqual(rupees(10_00));
  });
});

describe('validateTrailingStop (SPEC-TFC-1 §6.6)', () => {
  const base: Pick<
    TrailingStopParams,
    'trail' | 'activationPrice' | 'exitOrderType' | 'exitLimitOffset'
  > = {
    trail: rupees(10_00),
    activationPrice: null,
    exitOrderType: 'MARKET',
    exitLimitOffset: null,
  };
  const check = (params: Partial<typeof base>, ltp = 1_500_00, hasPosition = true) =>
    validateTrailingStop({ params: { ...base, ...params }, direction: 'LONG', ltp, hasPosition });

  it('accepts a sound stop', () => {
    expect(check({})).toEqual({ ok: true });
    expect(check({ trail: percent(150) })).toEqual({ ok: true });
  });

  it.each([
    ['no position', {}, 1_500_00, false, TRAILING_STOP_MESSAGES.noPosition, 'position'],
    [
      'zero trail',
      { trail: rupees(0) },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.trailNotPositive,
      'trail',
    ],
    [
      'negative trail',
      { trail: rupees(-5) },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.trailNotPositive,
      'trail',
    ],
    [
      'under a tick',
      { trail: rupees(3) },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.trailBelowTick,
      'trail',
    ],
    [
      'percent under a tick',
      { trail: percent(10) },
      40_00,
      true,
      TRAILING_STOP_MESSAGES.trailBelowTick,
      'trail',
    ],
    [
      'rupee trail over 20% of the price',
      { trail: rupees(300_05) },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.trailAboveMaxAmount('₹300.00'),
      'trail',
    ],
    [
      'percent under 0.10%',
      { trail: percent(9) },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.trailPercentOutOfRange,
      'trail',
    ],
    [
      'percent over 20%',
      { trail: percent(2_001) },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.trailPercentOutOfRange,
      'trail',
    ],
    [
      'fractional percent',
      { trail: percent(150.5) },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.trailPercentOutOfRange,
      'trail',
    ],
    [
      'limit offset below ₹0.05',
      { exitOrderType: 'LIMIT' as const, exitLimitOffset: 1_489_99 },
      1_500_00,
      true,
      TRAILING_STOP_MESSAGES.limitOffsetTooLarge,
      'exitLimitOffset',
    ],
  ] as const)('%s', (_name, params, ltp, hasPosition, message, field) => {
    expect(check(params, ltp, hasPosition)).toEqual({ ok: false, message, field });
  });

  it('accepts exactly 20% and an offset that leaves the limit at ₹0.05', () => {
    expect(check({ trail: rupees(300_00) })).toEqual({ ok: true });
    expect(check({ exitOrderType: 'LIMIT', exitLimitOffset: 1_489_95 })).toEqual({ ok: true });
  });
});

describe('validateStopPrice', () => {
  it('refuses a dragged stop at or through the price', () => {
    const wouldTrigger = {
      ok: false,
      message: TRAILING_STOP_MESSAGES.stopWouldTrigger,
      field: 'stopPrice',
    };
    expect(validateStopPrice(1_500_00, 1_500_00, 'LONG')).toEqual(wouldTrigger);
    expect(validateStopPrice(1_499_95, 1_500_00, 'LONG')).toEqual({ ok: true });
    expect(validateStopPrice(1_500_00, 1_500_00, 'SHORT')).toEqual(wouldTrigger);
    expect(validateStopPrice(1_500_05, 1_500_00, 'SHORT')).toEqual({ ok: true });
  });
});

describe('stopFromWatermark', () => {
  it('keeps the stop on the safe side of the watermark on the tick', () => {
    expect(stopFromWatermark('LONG', rupees(7), 1_000_00)).toBe(999_90);
    expect(stopFromWatermark('SHORT', rupees(7), 1_000_00)).toBe(1_000_10);
  });
});
