import { randomUUID } from 'node:crypto';
import { startLease } from '@nthstock/marketData';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { createPgAlertStore, startAlertDesk, type AlertDesk } from './alerts.js';
import { loadConfig } from './config.js';
import { jsonLogger } from './logger.js';
import { createFillWriter } from './fills.js';
import { startMatcher } from './matcher.js';
import {
  CONNECTION_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
  createPgLiveOrderSource,
} from './pgLiveOrders.js';

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

// The reconcile loop reads once a minute; the second connection stores fired price alerts.
const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      max: 2,
      application_name: 'apps/matcher',
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
    })
  : null;
pool?.on('error', (error: Error) => {
  jsonLogger.warn('postgres idle connection error', { error: error.message });
});
if (!pool) jsonLogger.warn('DATABASE_URL is not set: the books are not reconciled with Postgres');

const lease = startLease({
  redis,
  key: `lease:matcher:${String(config.shard)}`,
  holder: `matcher-${randomUUID()}`,
  ttlMs: config.leaseTtlMs,
  renewMs: config.leaseRenewMs,
  log: jsonLogger,
});
// Bound once the books exist: the alert desk puts the shard's active alerts on them.
let alerts: AlertDesk | null = null;
// Built before the matcher, so no tick can find it missing: a failed send puts the crossed orders
// and triggered stops back on the matcher's books, which exist by the time a tick acts.
const sendFills = createFillWriter({
  stream: redis,
  shard: config.shard,
  book: (token) => matcher.book(token),
  log: jsonLogger,
});
const matcher = startMatcher({
  client: streams,
  shard: config.shard,
  holdsLease: lease.isHeld,
  alwaysOpen: config.alwaysOpen,
  commands: { client: commands },
  ...(pool
    ? { reconcile: { source: createPgLiveOrderSource(pool, jsonLogger), shards: config.shards } }
    : {}),
  log: jsonLogger,
  onAlerts: (fired) => alerts?.onAlerts(fired),
  onTick: (tick) => {
    jsonLogger.info('tick acted', {
      symbol: tick.symbol,
      crossed: tick.crossed.length,
      triggered: tick.triggered.length,
      moved: tick.moved.length,
    });
    // The writer handles a failed send itself; this catches a bug in it, which would otherwise
    // be an unhandled rejection that ends the process.
    sendFills(tick).catch((error: unknown) => {
      jsonLogger.warn('fill writer failed', {
        shard: config.shard,
        token: tick.token,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    });
  },
});
alerts = pool
  ? startAlertDesk({
      store: createPgAlertStore(pool),
      publisher: redis,
      shard: config.shard,
      shards: config.shards,
      books: matcher.books,
      book: matcher.book,
      log: jsonLogger,
    })
  : null;
await Promise.all([matcher.ready(), alerts?.ready()]);
jsonLogger.info('matcher started', { shard: config.shard, shards: config.shards });

const shutdown = () => {
  void matcher
    .close()
    .then(() => alerts?.stop())
    .then(() => lease.stop())
    .then(() => pool?.end())
    .then(() => redis.quit())
    .finally(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
