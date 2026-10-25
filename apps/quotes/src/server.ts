import { randomUUID } from 'node:crypto';
import { MockMarketDataAdapter } from '@nthstock/marketData';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { startLease } from './lease.js';
import { jsonLogger } from './logger.js';
import { startQuoteWriter } from './quoteWriter.js';
import { createRedisTickSink } from './tickStream.js';

// apps/quotes (spec market-data-and-matching §4): the one source of ticks. It runs the mock
// market for one shard and writes its ticks while it holds the shard's lease. It depends on
// nothing but Redis, because it is the piece a licensed vendor feed replaces (D3).

const config = loadConfig(process.env);
// Ticks are not queued while Redis is away: a tick that cannot go out now is stale by the next.
const redis = new Redis(config.redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
redis.on('error', (error: Error) => {
  jsonLogger.warn('redis error', { error: error.message });
});

const market = new MockMarketDataAdapter({ alwaysOpen: config.alwaysOpen });
const lease = startLease({
  redis,
  key: `lease:quotes:${String(config.shard)}`,
  holder: `quotes-${randomUUID()}`,
  ttlMs: config.leaseTtlMs,
  renewMs: config.leaseRenewMs,
  log: jsonLogger,
});
const writer = await startQuoteWriter({
  market,
  shard: config.shard,
  shards: config.shards,
  holdsLease: lease.isHeld,
  sink: createRedisTickSink({ redis }),
  log: jsonLogger,
});
jsonLogger.info('quotes started', {
  shard: config.shard,
  shards: config.shards,
  instruments: writer.tokens.size,
});

const shutdown = () => {
  writer.stop();
  market.dispose();
  void lease
    .stop()
    .then(() => redis.quit())
    .finally(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
