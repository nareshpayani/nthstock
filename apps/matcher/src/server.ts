import { randomUUID } from 'node:crypto';
import { startLease } from '@nthstock/marketData';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { jsonLogger } from './logger.js';
import { startMatcher } from './matcher.js';

// apps/matcher (spec market-data-and-matching §5): one process per shard fills resting orders and
// triggers trailing stops off the tick stream, while it holds the shard's lease.

const config = loadConfig(process.env);
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
redis.on('error', (error: Error) => {
  jsonLogger.warn('redis error', { error: error.message });
});
// XREAD BLOCK holds its connection, so the follower gets one of its own.
const streams = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
streams.on('error', (error: Error) => {
  jsonLogger.warn('tick stream redis error', { error: error.message });
});

const commands = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
commands.on('error', (error: Error) => {
  jsonLogger.warn('matcher command redis error', { error: error.message });
});

const lease = startLease({
  redis,
  key: `lease:matcher:${String(config.shard)}`,
  holder: `matcher-${randomUUID()}`,
  ttlMs: config.leaseTtlMs,
  renewMs: config.leaseRenewMs,
  log: jsonLogger,
});
const matcher = startMatcher({
  client: streams,
  shard: config.shard,
  holdsLease: lease.isHeld,
  alwaysOpen: config.alwaysOpen,
  commands: { client: commands },
  log: jsonLogger,
  onTick: (tick) => {
    jsonLogger.info('tick acted', {
      symbol: tick.symbol,
      crossed: tick.crossed.length,
      triggered: tick.triggered.length,
      moved: tick.moved.length,
    });
  },
});
await matcher.ready();
jsonLogger.info('matcher started', { shard: config.shard, shards: config.shards });

const shutdown = () => {
  void matcher
    .close()
    .then(() => lease.stop())
    .then(() => redis.quit())
    .finally(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
