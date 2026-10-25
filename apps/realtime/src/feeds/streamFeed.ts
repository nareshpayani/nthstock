import { followTickStreams } from '@nthstock/marketData';
import { Redis } from 'ioredis';
import { silentLogger, type Logger } from '../logger.js';
import type { QuoteFeed, QuoteListener } from './feed.js';

export type RedisStreamQuoteFeed = QuoteFeed & {
  /** Resolves once the feed has read the snapshots and is waiting on the streams. */
  ready(): Promise<void>;
};

export type RedisStreamQuoteFeedOptions = {
  url: string;
  /** How many shards apps/quotes writes (`SHARDS`); the feed reads every one. */
  shards: number;
  /** Key names for a shard; tests pass their own so suites can share one Redis. */
  streamKey?: (shard: number) => string;
  snapshotKey?: (shard: number) => string;
  /** How long one `XREAD BLOCK` waits before it reads again; default 5 s. */
  blockMs?: number;
  logger?: Logger;
};

/**
 * Reads the tick streams apps/quotes writes (spec market-data-and-matching §4, NSTOCK-0353), in
 * place of the pub/sub tick channel, through `followTickStreams` from `packages/marketData`:
 * each shard's snapshot first, then the streams, re-reading a snapshot on any `seq` gap.
 */
export function createRedisStreamQuoteFeed(
  options: RedisStreamQuoteFeedOptions,
): RedisStreamQuoteFeed {
  const logger = options.logger ?? silentLogger;
  const listeners = new Set<QuoteListener>();
  // XREAD BLOCK holds its connection, so it gets one of its own.
  const client = new Redis(options.url, { maxRetriesPerRequest: null });
  let down = false;
  client.on('error', (error: Error) => {
    if (down) return;
    down = true;
    logger.warn('Redis tick stream unavailable', { error: error.message });
  });
  client.on('ready', () => {
    if (down) logger.info('Redis tick stream reconnected');
    down = false;
  });
  const follower = followTickStreams({
    client,
    shards: options.shards,
    ...(options.streamKey ? { streamKey: options.streamKey } : {}),
    ...(options.snapshotKey ? { snapshotKey: options.snapshotKey } : {}),
    ...(options.blockMs === undefined ? {} : { blockMs: options.blockMs }),
    log: logger,
    onQuotes: (quotes) => {
      for (const listener of [...listeners]) listener(quotes);
    },
  });

  return {
    onQuotes(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ready: () => follower.ready(),
    async close() {
      listeners.clear();
      await follower.close();
    },
  };
}
