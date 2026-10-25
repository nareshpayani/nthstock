import {
  TICK_STREAM_MAXLEN,
  quoteSnapshotKey,
  tickStreamKey,
  type TickStreamEntry,
} from '@nthstock/contracts';
import type { Redis } from 'ioredis';

/** Where a shard's tick batches go. Redis in the running service; a recorder in unit tests. */
export type TickSink = {
  append(entry: TickStreamEntry): Promise<void>;
};

export type RedisTickSinkOptions = {
  redis: Redis;
  /** Key names for a shard; tests pass their own so suites can share one Redis. */
  streamKey?: (shard: number) => string;
  snapshotKey?: (shard: number) => string;
};

/**
 * Appends each batch to the shard's stream (trimmed to about `TICK_STREAM_MAXLEN` entries) and
 * writes its quotes into the shard's snapshot hash, in one MULTI, so the snapshot never runs ahead
 * of or behind the stream.
 */
export function createRedisTickSink(options: RedisTickSinkOptions): TickSink {
  const { redis } = options;
  const streamKey = options.streamKey ?? tickStreamKey;
  const snapshotKey = options.snapshotKey ?? quoteSnapshotKey;
  return {
    async append(entry) {
      const latest = new Map(entry.quotes.map((quote) => [String(quote.token), quote]));
      const fields = [...latest].flatMap(([token, quote]) => [token, JSON.stringify(quote)]);
      const result = await redis
        .multi()
        .xadd(
          streamKey(entry.shard),
          'MAXLEN',
          '~',
          TICK_STREAM_MAXLEN,
          '*',
          'batch',
          JSON.stringify(entry),
        )
        .hset(snapshotKey(entry.shard), ...fields)
        .exec();
      const failed = result?.find(([error]) => error !== null)?.[0];
      if (!result || failed) throw failed ?? new Error('The tick batch was not written');
    },
  };
}
