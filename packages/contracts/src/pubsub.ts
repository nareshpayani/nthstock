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
 * The tick stream of one shard (spec market-data-and-matching §4): apps/quotes appends one entry
 * per batch with `XADD … MAXLEN ~ TICK_STREAM_MAXLEN`, so a consumer that falls behind or starts
 * late reads on from where it is instead of losing ticks, as pub/sub would.
 */
export const tickStreamKey = (shard: number): string => `nthstock:ticks:v1:${String(shard)}`;

/** About 10 minutes of batches at 4 a second. */
export const TICK_STREAM_MAXLEN = 2_400;

/**
 * The newest quote of every instrument in a shard, a hash of token to `Quote` JSON, written with
 * each batch. A consumer that starts, or sees a gap in `seq`, reads it to catch up.
 */
export const quoteSnapshotKey = (shard: number): string =>
  `nthstock:quotes:last:v1:${String(shard)}`;

/**
 * One entry of a tick stream, in its `batch` field as JSON. `seq` counts the shard's batches from
 * 1 for each quote-service process; any `seq` but the last one plus 1 means entries were missed
 * (a restarted writer or a trimmed stream). The quotes are full `Quote` objects rather than the
 * 24-byte frame records, because consumers need `symbol`, `open` and `prevClose` too.
 */
export const TickStreamEntry = z.object({
  v: z.literal(TICK_BATCH_VERSION),
  shard: z.number().int().min(0),
  seq: z.number().int().min(1),
  quotes: z.array(Quote).min(1),
});
export type TickStreamEntry = z.infer<typeof TickStreamEntry>;

/**
 * What a consumer does with the next entry of a shard's stream: `apply` it when it follows the
 * last one it applied, or `resync` from `quoteSnapshotKey` first when entries were missed (or it
 * has applied none yet).
 */
export function tickStreamStep(lastSeq: number | null, entry: Pick<TickStreamEntry, 'seq'>) {
  return lastSeq !== null && entry.seq === lastSeq + 1 ? 'apply' : 'resync';
}

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

/**
 * Session revocation (T-194, spec backend-core §7.2). When apps/api revokes a session (logout,
 * refresh-token reuse, a revoke by the user) it marks the session in Redis for as long as its
 * access tokens can live (`ACCESS_TOKEN_TTL_SEC`) and publishes a `SessionRevokedEvent`, so every
 * API instance refuses the session's access token at once and apps/realtime closes its sockets
 * (T-195). Postgres (`sessions.revoked_at`) stays the record; Redis only makes it fast.
 *
 * Both names take the deployment's key namespace (default `nthstock:`), so tests sharing one Redis
 * stay apart.
 */
export const DEFAULT_REDIS_NAMESPACE = 'nthstock:';

/** The channel carrying every `SessionRevokedEvent`. */
export const sessionRevokedChannel = (namespace: string = DEFAULT_REDIS_NAMESPACE): string =>
  `${namespace}auth:sessionRevoked:v1`;

/** The key marking one revoked session; present means refuse its access tokens. */
export const sessionRevokedKey = (
  sessionId: string,
  namespace: string = DEFAULT_REDIS_NAMESPACE,
): string => `${namespace}sess:revoked:${Id.parse(sessionId)}`;

export const SESSION_REVOKED_EVENT_VERSION = 1;

/** One revoked session, published as JSON on `sessionRevokedChannel()`. No PII: two opaque ids. */
export const SessionRevokedEvent = z.object({
  v: z.literal(SESSION_REVOKED_EVENT_VERSION),
  sessionId: Id,
  userId: Id,
});
export type SessionRevokedEvent = z.infer<typeof SessionRevokedEvent>;
