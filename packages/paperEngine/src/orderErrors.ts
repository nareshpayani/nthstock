import type { ApiErrorCode, Order } from '@nthstock/contracts';
import type { OrderActionErrorCode, OrderActionResult } from './paperEngine.js';

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
