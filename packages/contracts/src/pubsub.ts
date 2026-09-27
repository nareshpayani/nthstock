import { z } from 'zod';
import { Quote } from './market.js';
import { Order } from './orders.js';
import { Id } from './primitives.js';

/**
 * Server-to-server messages on Redis pub/sub (ADR 0004 §4). Browsers never see these; they get the
 * conflated WebSocket frames from apps/realtime instead.
 */

/** Redis channel carrying every adapter tick from apps/api to apps/realtime. */
export const TICKS_CHANNEL = 'nthstock:ticks:v1';

export const TICK_BATCH_VERSION = 1;

/** One adapter tick's quotes, published as JSON on `TICKS_CHANNEL`. */
export const TickBatch = z.object({
  v: z.literal(TICK_BATCH_VERSION),
  quotes: z.array(Quote).min(1),
});
export type TickBatch = z.infer<typeof TickBatch>;

/**
 * Per-user order updates (T-133): apps/api publishes every change to a user's orders on that
 * user's own channel, and each apps/realtime node subscribes only to the channels of users it has
 * a connection for. So an update only ever reaches the nodes, and then the connections, of the
 * user it belongs to.
 */
export const ORDER_UPDATES_CHANNEL_PREFIX = 'nthstock:orders:v1:';

/** The Redis channel carrying one user's order updates. */
export const orderUpdatesChannel = (userId: string): string =>
  `${ORDER_UPDATES_CHANNEL_PREFIX}${Id.parse(userId)}`;

export const ORDER_UPDATE_EVENT_VERSION = 1;

/**
 * One order change, published as JSON on `orderUpdatesChannel(userId)`. `userId` repeats the
 * channel's user so a subscriber can check the two agree before delivering it.
 */
export const OrderUpdateEvent = z.object({
  v: z.literal(ORDER_UPDATE_EVENT_VERSION),
  userId: Id,
  order: Order,
});
export type OrderUpdateEvent = z.infer<typeof OrderUpdateEvent>;
