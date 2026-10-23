import {
  ModifyTrailingStopRequest,
  TERMINAL_TRAILING_STOP_STATUSES,
  type ProductType,
  type Trail,
  type TrailingStop,
} from '@nthstock/contracts';
import { defaultTrailingValues, trailOf, type TrailingFormValues } from './trailingStopForm';

/** A new stop from the sheet trails by 1.0% (SPEC-TFC-1 §8.4): 100 basis points. */
export const DEFAULT_TRAIL_BP = 100;
const TICK = 5;
const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_TRAILING_STOP_STATUSES);

/** A stop that can still change: not executed, cancelled or rejected. */
export const isActiveStop = (stop: TrailingStop | null): stop is TrailingStop =>
  stop !== null && !TERMINAL.has(stop.status);

/** A triggered stop's exit is already working: it can no longer be updated or cancelled. */
export const isChangeableStop = (stop: TrailingStop | null): stop is TrailingStop =>
  isActiveStop(stop) && stop.status !== 'TRIGGERED';

/**
 * The default trail in a unit (§8.4): 1.0%, or in rupees 1% of the LTP on the ₹0.05 tick (never
 * below one tick). Null for rupees until the LTP is known.
 */
export function defaultTrailValue(unit: Trail['unit'], ltp: number | null): number | null {
  if (unit === 'PERCENT') return DEFAULT_TRAIL_BP;
  if (ltp === null || ltp <= 0) return null;
  return Math.max(TICK, Math.round(ltp / 100 / TICK) * TICK);
}

/** The sheet's values: the stop's own terms when it has one, else a 1.0% trail with a market exit. */
export function sheetValues(stop: TrailingStop | null, product: ProductType): TrailingFormValues {
  if (!isActiveStop(stop)) {
    return { ...defaultTrailingValues(product), value: DEFAULT_TRAIL_BP };
  }
  return {
    product: stop.product,
    unit: stop.trail.unit,
    value: stop.trail.unit === 'PERCENT' ? stop.trail.basisPoints : stop.trail.amount,
    activationPrice: stop.activationPrice,
    exitOrderType: stop.exitOrderType,
    exitLimitOffset: stop.exitLimitOffset,
  };
}

const sameTrail = (a: Trail, b: Trail) =>
  a.unit === 'PERCENT'
    ? b.unit === 'PERCENT' && a.basisPoints === b.basisPoints
    : b.unit === 'AMOUNT' && a.amount === b.amount;

/**
 * The `PATCH` body for an Update from the sheet: the new trail, which the engine applies from the
 * watermark (§6.5). Null while the trail is empty or unchanged.
 */
export function toTrailModify(
  values: Pick<TrailingFormValues, 'unit' | 'value'>,
  stop: TrailingStop,
): ModifyTrailingStopRequest | null {
  const trail = trailOf(values);
  if (trail === null || sameTrail(trail, stop.trail)) return null;
  return ModifyTrailingStopRequest.parse({ trail });
}
