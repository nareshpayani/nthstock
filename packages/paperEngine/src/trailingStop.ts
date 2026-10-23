import {
  TICK_SIZE_PAISE,
  TRAILING_STOP_LIMITS,
  TRAILING_STOP_MESSAGES,
  type PositionDirection,
  type Trail,
  type TrailingStopParams,
  type TrailingStopStatus,
} from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';

/**
 * Trailing stop-loss arithmetic (SPEC-TFC-1 §6.3, §6.5, §6.6): pure functions with no clock and no
 * engine state, so the engine steps stops with them and the ticket and chart preview a stop with
 * the very same code. Prices are integer paise on the 5-paise tick. Rules are written for a long
 * position; a short mirrors every comparison (lowest instead of highest price, stop above instead
 * of below, ceiling instead of floor).
 */

/** The part of a trailing stop the per-tick rules read and write. */
export type TrailingStopState = {
  status: TrailingStopStatus;
  direction: PositionDirection;
  trail: Trail;
  activationPrice: number | null;
  /** Best price since activation; null before TRAILING. */
  watermarkPrice: number | null;
  /** The current stop; null before TRAILING. */
  stopPrice: number | null;
};

export type TrailingStopStep = {
  state: TrailingStopState;
  /** True on the one tick that moved the stop to TRIGGERED: the caller places the exit then. */
  triggered: boolean;
};

const BASIS_POINTS = 10_000;

export const floorToTick = (paise: number): number =>
  Math.floor(paise / TICK_SIZE_PAISE) * TICK_SIZE_PAISE;

export const ceilToTick = (paise: number): number =>
  Math.ceil(paise / TICK_SIZE_PAISE) * TICK_SIZE_PAISE;

/** The trail in paise at a watermark: the amount itself, or that share of the watermark. */
export function trailPaise(trail: Trail, watermarkPrice: number): number {
  return trail.unit === 'AMOUNT'
    ? trail.amount
    : (watermarkPrice * trail.basisPoints) / BASIS_POINTS;
}

/**
 * The stop a trail gives at a watermark, on the tick and on the safe side: floored below a long
 * position's best price, ceiled above a short position's. Integer arithmetic for percent trails, so
 * no float rounding can move a stop by a tick.
 */
export function stopFromWatermark(
  direction: PositionDirection,
  trail: Trail,
  watermarkPrice: number,
): number {
  if (trail.unit === 'AMOUNT') {
    return direction === 'LONG'
      ? floorToTick(watermarkPrice - trail.amount)
      : ceilToTick(watermarkPrice + trail.amount);
  }
  return direction === 'LONG'
    ? floorToTick(Math.floor((watermarkPrice * (BASIS_POINTS - trail.basisPoints)) / BASIS_POINTS))
    : ceilToTick(Math.ceil((watermarkPrice * (BASIS_POINTS + trail.basisPoints)) / BASIS_POINTS));
}

const better = (direction: PositionDirection, a: number, b: number): number =>
  direction === 'LONG' ? Math.max(a, b) : Math.min(a, b);

/** True when the price is at or through the stop: at or below for a long, at or above for a short. */
const reached = (direction: PositionDirection, ltp: number, stopPrice: number): boolean =>
  direction === 'LONG' ? ltp <= stopPrice : ltp >= stopPrice;

const activates = (state: TrailingStopState, ltp: number): boolean =>
  state.activationPrice === null ||
  (state.direction === 'LONG' ? ltp >= state.activationPrice : ltp <= state.activationPrice);

/**
 * One tick for one trailing stop (SPEC-TFC-1 §6.3):
 * 1. ARMED activates when there is no activation price or the price reaches it; the watermark
 *    starts at that price and the stop is computed on the same tick. The stop is always on the
 *    safe side of the price then, so activation never triggers.
 * 2. TRAILING moves the watermark to the better of itself and the price, and the stop to the
 *    better of itself and the stop the trail gives: it never moves against the position.
 * 3. TRAILING triggers when the price is at or through the stop, gaps included, exactly once:
 *    TRIGGERED and the terminal statuses ignore later ticks.
 */
export function stepTrailingStop(state: TrailingStopState, ltp: number): TrailingStopStep {
  if (state.status === 'ARMED') {
    if (!activates(state, ltp)) return { state, triggered: false };
    return {
      state: {
        ...state,
        status: 'TRAILING',
        watermarkPrice: ltp,
        stopPrice: stopFromWatermark(state.direction, state.trail, ltp),
      },
      triggered: false,
    };
  }
  if (state.status !== 'TRAILING' || state.watermarkPrice === null || state.stopPrice === null) {
    return { state, triggered: false };
  }
  const watermarkPrice = better(state.direction, state.watermarkPrice, ltp);
  const stopPrice = better(
    state.direction,
    state.stopPrice,
    stopFromWatermark(state.direction, state.trail, watermarkPrice),
  );
  if (reached(state.direction, ltp, stopPrice)) {
    return {
      state: { ...state, status: 'TRIGGERED', watermarkPrice, stopPrice },
      triggered: true,
    };
  }
  return { state: { ...state, watermarkPrice, stopPrice }, triggered: false };
}

export type TrailingStopPreview = {
  /** TRAILING when the stop would start at once, ARMED when it waits for its activation price. */
  status: 'ARMED' | 'TRAILING';
  /** The stop the engine would set on placement; for an armed stop, the stop at activation. */
  stopPrice: number;
  /** An activation price already reached: the preview says "Activates immediately". */
  activatesImmediately: boolean;
};

/**
 * The stop a trailing stop would start with if placed now at `ltp` (SPEC-TFC-1 §6.3): the same
 * first engine step the engine runs on placement, so what the ticket and chart show is what the
 * engine sets. An armed stop previews the stop it will start with at its activation price.
 */
export function previewTrailingStop(
  params: Pick<TrailingStopParams, 'trail' | 'activationPrice'>,
  ltp: number,
  direction: PositionDirection,
): TrailingStopPreview {
  const { state } = stepTrailingStop(armedState(params, direction), ltp);
  if (state.status === 'TRAILING' && state.stopPrice !== null) {
    return {
      status: 'TRAILING',
      stopPrice: state.stopPrice,
      activatesImmediately: params.activationPrice !== null,
    };
  }
  const activationPrice = params.activationPrice ?? ltp;
  return {
    status: 'ARMED',
    stopPrice: stopFromWatermark(direction, params.trail, activationPrice),
    activatesImmediately: false,
  };
}

/** A new trailing stop before its first tick. */
export function armedState(
  params: Pick<TrailingStopParams, 'trail' | 'activationPrice'>,
  direction: PositionDirection,
): TrailingStopState {
  return {
    status: 'ARMED',
    direction,
    trail: params.trail,
    activationPrice: params.activationPrice,
    watermarkPrice: null,
    stopPrice: null,
  };
}

export type TrailingStopModify = { trail: Trail } | { stopPrice: number };

/**
 * Applies a new trail, or a dragged stop price, to a stop (SPEC-TFC-1 §6.5). A stop price becomes
 * a rupee trail measured from the watermark at the moment the change applies, so a market that
 * moved since the drag cannot make it stale. The new stop is the ratchet baseline: a modify may
 * widen the trail as well as tighten it. A stop that is not trailing yet only takes the new trail.
 */
export function modifyTrailingStop(
  state: TrailingStopState,
  change: TrailingStopModify,
): TrailingStopState {
  const watermark = state.status === 'TRAILING' ? state.watermarkPrice : null;
  let trail: Trail;
  if ('trail' in change) {
    trail = change.trail;
  } else {
    const reference = watermark ?? state.activationPrice;
    if (reference === null) throw new RangeError('A stop price needs a watermark or activation');
    const amount =
      state.direction === 'LONG' ? reference - change.stopPrice : change.stopPrice - reference;
    if (amount <= 0) throw new RangeError(TRAILING_STOP_MESSAGES.stopWouldTrigger);
    trail = { unit: 'AMOUNT', amount };
  }
  if (watermark === null) return { ...state, trail };
  return { ...state, trail, stopPrice: stopFromWatermark(state.direction, trail, watermark) };
}

export type TrailingStopCheck =
  | { ok: true }
  | {
      ok: false;
      /** The §6.6 message, word for word. */
      message: string;
      field: 'position' | 'trail' | 'stopPrice' | 'exitLimitOffset';
    };

export type TrailingStopCheckInput = {
  params: Pick<
    TrailingStopParams,
    'trail' | 'activationPrice' | 'exitOrderType' | 'exitLimitOffset'
  >;
  direction: PositionDirection;
  /** The price the trail is judged against: the LTP when placing or modifying. */
  ltp: number;
  /** False when there is no open position in the instrument and product. */
  hasPosition: boolean;
};

const fail = (message: string, field: Extract<TrailingStopCheck, { ok: false }>['field']) =>
  ({ ok: false, message, field }) as const;

/**
 * The SPEC-TFC-1 §6.6 rules, in order, returning the first failure with its exact message. The
 * engine runs this on every place and modify; the ticket and chart run it as the user types or
 * drags, so they never disagree.
 */
export function validateTrailingStop(input: TrailingStopCheckInput): TrailingStopCheck {
  const { params, direction, ltp } = input;
  if (!input.hasPosition) return fail(TRAILING_STOP_MESSAGES.noPosition, 'position');

  const { trail } = params;
  if (trail.unit === 'AMOUNT') {
    if (trail.amount <= 0) return fail(TRAILING_STOP_MESSAGES.trailNotPositive, 'trail');
    if (trail.amount < TRAILING_STOP_LIMITS.minTrailPaise) {
      return fail(TRAILING_STOP_MESSAGES.trailBelowTick, 'trail');
    }
    const maxAmount = Math.floor((ltp * TRAILING_STOP_LIMITS.maxTrailBasisPoints) / BASIS_POINTS);
    if (trail.amount > maxAmount) {
      return fail(TRAILING_STOP_MESSAGES.trailAboveMaxAmount(formatInr(maxAmount)), 'trail');
    }
  } else {
    const { basisPoints } = trail;
    if (
      !Number.isInteger(basisPoints) ||
      basisPoints < TRAILING_STOP_LIMITS.minTrailBasisPoints ||
      basisPoints > TRAILING_STOP_LIMITS.maxTrailBasisPoints
    ) {
      return fail(TRAILING_STOP_MESSAGES.trailPercentOutOfRange, 'trail');
    }
    if (trailPaise(trail, ltp) < TRAILING_STOP_LIMITS.minTrailPaise) {
      return fail(TRAILING_STOP_MESSAGES.trailBelowTick, 'trail');
    }
  }

  if (params.exitOrderType === 'LIMIT' && direction === 'LONG') {
    const { stopPrice } = previewTrailingStop(params, ltp, direction);
    if (stopPrice - (params.exitLimitOffset ?? 0) < TICK_SIZE_PAISE) {
      return fail(TRAILING_STOP_MESSAGES.limitOffsetTooLarge, 'exitLimitOffset');
    }
  }
  return { ok: true };
}

/** A dragged stop must stay on the safe side of the price: below it for a long, above for a short. */
export function validateStopPrice(
  stopPrice: number,
  ltp: number,
  direction: PositionDirection,
): TrailingStopCheck {
  return reached(direction, ltp, stopPrice)
    ? fail(TRAILING_STOP_MESSAGES.stopWouldTrigger, 'stopPrice')
    : { ok: true };
}
