import { z } from 'zod';
import { Quote } from './market.js';

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
