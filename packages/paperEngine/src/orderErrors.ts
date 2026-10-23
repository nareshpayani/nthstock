import type { ApiErrorCode, Order, TrailingStop } from '@nthstock/contracts';
import type {
  OrderActionErrorCode,
  OrderActionResult,
  TrailingStopActionErrorCode,
  TrailingStopActionResult,
} from './paperEngine.js';

/** How a refused order action answers over HTTP, the same from apps/api and the MSW mock. */
export type OrderApiError = {
  status: number;
  code: ApiErrorCode;
  /** The engine's plain-language reason. */
  message: string;
  /** `reason` is the engine's code; `order` the REJECTED (or unchanged) order when there is one. */
  details: { reason: OrderActionErrorCode; order?: Order };
};

const HTTP: Record<OrderActionErrorCode, readonly [status: number, code: ApiErrorCode]> = {
  // Malformed requests: nothing was stored.
  INVALID_QTY: [400, 'VALIDATION_ERROR'],
  PRICE_REQUIRED: [400, 'VALIDATION_ERROR'],
  PRICE_NOT_ALLOWED: [400, 'VALIDATION_ERROR'],
  PRICE_OFF_TICK: [400, 'VALIDATION_ERROR'],
  NOTHING_TO_CHANGE: [400, 'VALIDATION_ERROR'],
  NOT_SUPPORTED: [400, 'VALIDATION_ERROR'],
  // An attached trailing stop's parameters (SPEC-TFC-1 §6.6); closing a position with none.
  INVALID_TRAIL: [400, 'VALIDATION_ERROR'],
  INVALID_STOP_PRICE: [400, 'VALIDATION_ERROR'],
  INVALID_LIMIT_OFFSET: [400, 'VALIDATION_ERROR'],
  NO_POSITION: [422, 'ORDER_REJECTED'],
  UNKNOWN_INSTRUMENT: [404, 'NOT_FOUND'],
  ORDER_NOT_FOUND: [404, 'NOT_FOUND'],
  // Modify or cancel of an order that is no longer AMO or OPEN.
  ILLEGAL_TRANSITION: [409, 'INVALID_ORDER_STATE'],
  // Risk checks: a place stores the order as REJECTED; a modify leaves the order as it was.
  INSUFFICIENT_FUNDS: [422, 'INSUFFICIENT_FUNDS'],
  INSUFFICIENT_HOLDINGS: [422, 'INSUFFICIENT_HOLDINGS'],
  INTRADAY_MARKET_CLOSED: [422, 'MARKET_CLOSED'],
  ORDER_TOO_LARGE: [422, 'ORDER_REJECTED'],
  NO_PRICE: [422, 'ORDER_REJECTED'],
  OUTSIDE_CIRCUIT: [422, 'ORDER_REJECTED'],
};

/** The ApiError parts for a refused place, modify or cancel. */
export function orderApiError(result: Extract<OrderActionResult, { ok: false }>): OrderApiError {
  const [status, code] = HTTP[result.code];
  return {
    status,
    code,
    message: result.reason,
    details: { reason: result.code, ...(result.order ? { order: result.order } : {}) },
  };
}

/** How a refused trailing-stop action answers over HTTP (SPEC-TFC-1 §10.6). */
export type TrailingStopApiError = {
  status: number;
  code: ApiErrorCode;
  message: string;
  details: { reason: TrailingStopActionErrorCode; trailingStop?: TrailingStop };
};

const STOP_HTTP: Record<
  TrailingStopActionErrorCode,
  readonly [status: number, code: ApiErrorCode]
> = {
  INVALID_TRAIL: [400, 'VALIDATION_ERROR'],
  INVALID_STOP_PRICE: [400, 'VALIDATION_ERROR'],
  INVALID_LIMIT_OFFSET: [400, 'VALIDATION_ERROR'],
  NOTHING_TO_CHANGE: [400, 'VALIDATION_ERROR'],
  NOT_SUPPORTED: [400, 'VALIDATION_ERROR'],
  TRAILING_STOP_NOT_FOUND: [404, 'NOT_FOUND'],
  ILLEGAL_TRANSITION: [409, 'INVALID_ORDER_STATE'],
  NO_POSITION: [422, 'ORDER_REJECTED'],
  NO_PRICE: [422, 'ORDER_REJECTED'],
};

/** The ApiError parts for a refused trailing-stop place, modify or cancel. */
export function trailingStopApiError(
  result: Extract<TrailingStopActionResult, { ok: false }>,
): TrailingStopApiError {
  const [status, code] = STOP_HTTP[result.code];
  return {
    status,
    code,
    message: result.reason,
    details: {
      reason: result.code,
      ...(result.trailingStop ? { trailingStop: result.trailingStop } : {}),
    },
  };
}
