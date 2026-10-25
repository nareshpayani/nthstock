import { z } from 'zod';
import { OrderSide } from './orders.js';
import { Id, InstrumentToken, Paise, TickPrice } from './primitives.js';
import { Trail } from './trailingStopParams.js';
import { PriceAlertCondition } from './alerts.js';
import { PositionDirection, TrailingStopStatus } from './trailingStops.js';

/**
 * Commands from apps/api to the matcher worker (spec market-data-and-matching §5.3): after its own
 * commit, apps/api appends one to its shard's stream, and the matcher applies it to the
 * instrument's book only when `version` is newer than the entry it holds. `version` is the
 * account store's version after that commit, which only grows for a user, so a late or replayed
 * command never undoes a newer one. A lost command is repaired by the matcher's reconcile loop.
 */
export const MATCHER_COMMAND_VERSION = 1;

/** The command stream of one shard, `shardOf(token, QUOTE_SHARDS)`. */
export const matcherCommandsKey = (shard: number): string =>
  `nthstock:matcher:commands:v1:${String(shard)}`;

/** About a day of order changes at a busy pace; the reconcile loop covers anything older. */
export const MATCHER_COMMANDS_MAXLEN = 100_000;

const base = {
  v: z.literal(MATCHER_COMMAND_VERSION),
  token: InstrumentToken,
  version: z.number().int().min(0),
};

/** A resting LIMIT order, at its price. */
const restingOrder = { ...base, orderId: Id, userId: Id, side: OrderSide, price: TickPrice };

/** The part of a trailing stop the matcher steps (`TrailingStopState` in the paper engine). */
export const MatcherStopState = z.object({
  status: TrailingStopStatus,
  direction: PositionDirection,
  trail: Trail,
  activationPrice: TickPrice.nullable(),
  watermarkPrice: Paise.positive().nullable(),
  stopPrice: Paise.positive().nullable(),
});
export type MatcherStopState = z.infer<typeof MatcherStopState>;

export const MatcherCommand = z.discriminatedUnion('type', [
  z.object({ ...restingOrder, type: z.literal('ADD') }),
  z.object({ ...restingOrder, type: z.literal('MODIFY') }),
  z.object({ ...base, type: z.literal('CANCEL'), orderId: Id }),
  z.object({
    ...base,
    type: z.literal('STOP_ADD'),
    stopId: Id,
    userId: Id,
    state: MatcherStopState,
  }),
  z.object({ ...base, type: z.literal('STOP_CANCEL'), stopId: Id }),
  // Price alerts (NSTOCK-0383): an alert is added once and fires or is cancelled once, so its
  // `version` is 0; firing is made exactly-once by the store, not by the book.
  z.object({
    ...base,
    type: z.literal('ALERT_ADD'),
    alertId: Id,
    userId: Id,
    condition: PriceAlertCondition,
    price: TickPrice,
  }),
  z.object({ ...base, type: z.literal('ALERT_CANCEL'), alertId: Id }),
]);
export type MatcherCommand = z.infer<typeof MatcherCommand>;
