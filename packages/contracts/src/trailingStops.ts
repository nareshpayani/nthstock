import { z } from 'zod';
import {
  Count,
  Exchange,
  Id,
  InstrumentToken,
  IsoUtc,
  NonNegativePaise,
  Seq,
  TickPrice,
  TradingSymbol,
} from './primitives.js';
import { ProductType } from './orders.js';
import {
  ExitLimitOffset,
  Trail,
  TrailingStopExitType,
  checkExitFields,
  trailingStopParamsShape,
} from './trailingStopParams.js';

/**
 * A trailing stop-loss (TSLO) protects one open position: its stop follows the best price since
 * activation by a fixed trail, never loosens, and closes the position when the price comes back to
 * it (SPEC-TFC-1 §6). The paper engine owns every field below except the user's parameters.
 */

/**
 * PENDING_ENTRY → ARMED → TRAILING → TRIGGERED → EXECUTED, or CANCELLED and REJECTED
 * (SPEC-TFC-1 §6.2). EXECUTED, CANCELLED and REJECTED are terminal.
 */
export const TrailingStopStatus = z.enum([
  /** Attached to an entry order that has not filled yet. */
  'PENDING_ENTRY',
  /** Waiting for the LTP to reach the activation price. */
  'ARMED',
  /** The stop is live and ratchets with the price. */
  'TRAILING',
  /** The price reached the stop; the exit order is working. */
  'TRIGGERED',
  /** The exit filled and the position is flat. */
  'EXECUTED',
  /** No longer active: by the user, because the position closed or flipped, or at day end. */
  'CANCELLED',
  /** The exit could not be placed; the position is unprotected. */
  'REJECTED',
]);
export type TrailingStopStatus = z.infer<typeof TrailingStopStatus>;

/** Statuses after which a trailing stop never changes again. */
export const TERMINAL_TRAILING_STOP_STATUSES = [
  'EXECUTED',
  'CANCELLED',
  'REJECTED',
] as const satisfies readonly TrailingStopStatus[];

/** The direction of the protected position: LONG stops sit below the price, SHORT stops above. */
export const PositionDirection = z.enum(['LONG', 'SHORT']);
export type PositionDirection = z.infer<typeof PositionDirection>;

/** One position: an instrument in one product. A position has at most one trailing stop. */
export const PositionKey = z.object({ token: InstrumentToken, product: ProductType });
export type PositionKey = z.infer<typeof PositionKey>;

export const TrailingStop = z.object({
  id: Id,
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  product: ProductType,
  direction: PositionDirection,
  trail: Trail,
  activationPrice: TickPrice.nullable(),
  exitOrderType: TrailingStopExitType,
  exitLimitOffset: ExitLimitOffset.nullable(),
  status: TrailingStopStatus,
  /** Plain-language reason for CANCELLED and REJECTED, e.g. "Position closed". */
  statusReason: z.string().max(200).nullable(),
  /** Best price since activation (highest for LONG, lowest for SHORT); null before TRAILING. */
  watermarkPrice: NonNegativePaise.nullable(),
  /** The current stop on the 5-paise tick; null before TRAILING. */
  stopPrice: TickPrice.nullable(),
  /** Always the position's open quantity, so the exit closes exactly what is open. */
  protectedQty: Count,
  /** The entry order a stop was attached to; null for a stop placed on an open position. */
  entryOrderId: Id.nullable(),
  /** The reduce-only exit the trigger placed; null until TRIGGERED. */
  exitOrderId: Id.nullable(),
  /** The engine sequence number of this stop's latest change (ADR 0012). */
  seq: Seq,
  createdAt: IsoUtc,
  updatedAt: IsoUtc,
});
export type TrailingStop = z.infer<typeof TrailingStop>;

/**
 * Protect an open position. Placing a stop on a position that already has an active one replaces
 * it (SPEC-TFC-1 §6.1).
 */
export const PlaceTrailingStopRequest = PositionKey.extend({
  ...trailingStopParamsShape,
  /** Client-generated idempotency key, so a retried place does not create a second stop. */
  clientRequestId: Id.optional(),
}).superRefine(checkExitFields);
export type PlaceTrailingStopRequest = z.infer<typeof PlaceTrailingStopRequest>;

/**
 * Change an active trailing stop (SPEC-TFC-1 §6.5). Send a new `trail`, or a `stopPrice` (a drag of
 * the chart line) that the engine turns into a trail from its watermark when it applies the
 * change; never both. The new stop becomes the ratchet baseline, so a trail can widen.
 */
export const ModifyTrailingStopRequest = z
  .object({
    trail: Trail.optional(),
    stopPrice: TickPrice.optional(),
    activationPrice: TickPrice.nullable().optional(),
    exitOrderType: TrailingStopExitType.optional(),
    exitLimitOffset: ExitLimitOffset.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.values(value).every((field) => field === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Nothing to change' });
    }
    if (value.trail !== undefined && value.stopPrice !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['stopPrice'],
        message: 'Send a trail or a stop price, not both',
      });
    }
    if (value.exitOrderType !== undefined) checkExitFields(value, ctx);
  });
export type ModifyTrailingStopRequest = z.infer<typeof ModifyTrailingStopRequest>;

/** Path params for modify and cancel. Cancel has no body. */
export const TrailingStopIdParams = z.object({ id: Id });
export type TrailingStopIdParams = z.infer<typeof TrailingStopIdParams>;

/** `GET /v1/trailing-stops`: today's trailing stops, active and finished, newest first. */
export const TrailingStopsResponse = z.object({ items: z.array(TrailingStop) });
export type TrailingStopsResponse = z.infer<typeof TrailingStopsResponse>;
