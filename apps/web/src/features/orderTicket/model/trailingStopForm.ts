import {
  PlaceTrailingStopRequest,
  TRAILING_STOP_MESSAGES,
  type Position,
  type PositionDirection,
  type ProductType,
  type Trail,
  type TrailingStopExitType,
} from '@nthstock/contracts';
import { previewTrailingStop, validateTrailingStop } from '@nthstock/paperEngine';
import { formatInr } from '@nthstock/utils';
import { strings } from '../strings';

/**
 * The Trailing SL order type (T13, SPEC-TFC-1 §6 and §7): an exit for an open position, so the
 * quantity is the position's, never typed. The rules are the engine's own `validateTrailingStop`
 * and `previewTrailingStop`, so the ticket shows exactly what the engine will accept and set.
 *
 * `value` is held as an integer in hundredths, from the same price input as a rupee amount: paise
 * for a ₹ trail, basis points for a % trail (1.50 typed is 150 either way).
 */
export type TrailingFormValues = {
  product: ProductType;
  unit: Trail['unit'];
  value: number | null;
  /** Paise, or null for "start trailing now". */
  activationPrice: number | null;
  exitOrderType: TrailingStopExitType;
  /** Paise below (long) or above (short) the stop for a limit exit. */
  exitLimitOffset: number | null;
};

/** Open positions in the instrument, one per product, that a trailing stop can protect. */
export const openPositions = (positions: readonly Position[], token: number): Position[] =>
  positions.filter((position) => position.token === token && position.netQty !== 0);

export const directionOf = (position: Pick<Position, 'netQty'>): PositionDirection =>
  position.netQty > 0 ? 'LONG' : 'SHORT';

export function defaultTrailingValues(product: ProductType): TrailingFormValues {
  return {
    product,
    unit: 'PERCENT',
    value: null,
    activationPrice: null,
    exitOrderType: 'MARKET',
    exitLimitOffset: null,
  };
}

/** The trail the values describe; null while the value is empty. */
export function trailOf(values: Pick<TrailingFormValues, 'unit' | 'value'>): Trail | null {
  if (values.value === null) return null;
  return values.unit === 'AMOUNT'
    ? { unit: 'AMOUNT', amount: values.value }
    : { unit: 'PERCENT', basisPoints: values.value };
}

export type TrailingCheck =
  { ok: true } | { ok: false; field: 'value' | 'exitLimitOffset' | 'form'; message: string };

/** The §6.6 rules as the user types: the first failure, with the engine's exact message. */
export function checkTrailing(
  values: TrailingFormValues,
  context: { position: Position | undefined; ltp: number | null },
): TrailingCheck {
  if (!context.position) {
    return { ok: false, field: 'form', message: TRAILING_STOP_MESSAGES.noPosition };
  }
  const trail = trailOf(values);
  if (trail === null || values.value === 0) {
    return { ok: false, field: 'value', message: TRAILING_STOP_MESSAGES.trailNotPositive };
  }
  if (values.exitOrderType === 'LIMIT' && values.exitLimitOffset === null) {
    return {
      ok: false,
      field: 'exitLimitOffset',
      message: TRAILING_STOP_MESSAGES.limitOffsetRequired,
    };
  }
  if (context.ltp === null) return { ok: true }; // The engine checks again on place.
  const check = validateTrailingStop({
    params: paramsOf(values, trail),
    direction: directionOf(context.position),
    ltp: context.ltp,
    hasPosition: true,
  });
  if (check.ok) return { ok: true };
  return {
    ok: false,
    field: check.field === 'exitLimitOffset' ? 'exitLimitOffset' : 'value',
    message: check.message,
  };
}

const paramsOf = (values: TrailingFormValues, trail: Trail) => ({
  trail,
  activationPrice: values.activationPrice,
  exitOrderType: values.exitOrderType,
  exitLimitOffset: values.exitOrderType === 'LIMIT' ? values.exitLimitOffset : null,
});

/** "1.5%" or "₹12.50": how the trail reads in the preview and the review. */
export function trailText(trail: Trail): string {
  if (trail.unit === 'AMOUNT') return formatInr(trail.amount);
  const whole = trail.basisPoints / 100;
  return `${whole.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}

/**
 * The live preview (§7): "Initial stop ₹1,480.00, trails 1.5% below the high (activates at
 * ₹1,520.00)". Null while the values or the price are not enough to say.
 */
export function previewText(
  values: TrailingFormValues,
  ltp: number | null,
  direction: PositionDirection,
): string | null {
  const trail = trailOf(values);
  if (trail === null || ltp === null || values.value === 0) return null;
  const preview = previewTrailingStop(
    { trail, activationPrice: values.activationPrice },
    ltp,
    direction,
  );
  const base = strings.trailing.preview(
    formatInr(preview.stopPrice),
    trailText(trail),
    direction === 'LONG' ? strings.trailing.belowHigh : strings.trailing.aboveLow,
  );
  if (values.activationPrice === null) return base;
  return preview.activatesImmediately
    ? `${base} ${strings.trailing.activatesImmediately}`
    : `${base} ${strings.trailing.activatesAt(formatInr(values.activationPrice))}`;
}

/** The one sentence the review step restates before Confirm (§7). */
export function reviewSentence(
  values: TrailingFormValues,
  position: Position,
  symbol: string,
): string {
  const trail = trailOf(values);
  const qty = Math.abs(position.netQty);
  const exitSide = directionOf(position) === 'LONG' ? strings.sides.SELL : strings.sides.BUY;
  const exit =
    values.exitOrderType === 'MARKET'
      ? strings.trailing.exitMarket
      : strings.trailing.exitLimit(formatInr(values.exitLimitOffset ?? 0));
  return strings.trailing.reviewSentence(
    exitSide,
    qty,
    symbol,
    trail ? trailText(trail) : '',
    directionOf(position) === 'LONG'
      ? strings.trailing.fallsFromHigh
      : strings.trailing.risesFromLow,
    exit,
  );
}

/** The `POST /v1/trailing-stops` body for checked values (throws when they were not checked). */
export function toPlaceTrailingStopRequest(
  values: TrailingFormValues,
  token: number,
): PlaceTrailingStopRequest {
  const trail = trailOf(values);
  if (trail === null) throw new Error('Trailing stop values were not checked');
  return PlaceTrailingStopRequest.parse({
    token,
    product: values.product,
    ...paramsOf(values, trail),
  });
}
