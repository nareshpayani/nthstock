import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { createDeps } from './deps.js';
import { createJobs, startJobScheduler } from './modules/jobs/index.js';
import { startOrderUpdatePublisher } from './modules/orders/index.js';
import { createRedisPublisher } from './ticks/publisher.js';

// The job worker (spec backend-core §3, §9; T-207): the same codebase as the API with another
// entry, so the jobs share its repos and the paper engine. `npm run worker -w @nthstock/api`
// with JOBS_MODE=bullmq, DB_DRIVER=postgres, DATABASE_URL and REDIS_URL, like `npm run dev:api`.

/** One JSON line per event, as the API's Fastify logger writes them. */
const log = {
  info(message: string, fields: Record<string, unknown> = {}) {
    process.stdout.write(
      `${JSON.stringify({ level: 30, time: Date.now(), msg: message, ...fields })}\n`,
    );
  },
  warn(message: string, fields: Record<string, unknown> = {}) {
    process.stderr.write(
      `${JSON.stringify({ level: 40, time: Date.now(), msg: message, ...fields })}\n`,
    );
  },
};

const QUOTE_SNAPSHOT_WAIT_MS = 5_000;

const config = loadConfig(process.env);
if (config.jobsMode !== 'bullmq' || !config.redisUrl) {
  log.warn('the job worker needs JOBS_MODE=bullmq (with DB_DRIVER=postgres and REDIS_URL)');
  process.exit(1);
}

const stateRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
const deps = createDeps({
  dbDriver: config.dbDriver,
  ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
  pgPoolMax: Math.min(config.pgPoolMax, 4),
  redis: stateRedis,
  onDatabaseError: (error) => log.warn('postgres pool error', { error: error.message }),
  marketAlwaysOpen: config.mockMarketAlwaysOpen,
  // Square-off fills at the prices the API sees: the quote service's, when it runs.
  ...(config.quoteShards !== null
    ? { quoteStreams: { url: config.redisUrl, shards: config.quoteShards, log } }
    : {}),
  production: config.production,
  piiKeys: config.pii.keys,
  onAuditError: (error) => log.warn('audit write failed', { error: error.message }),
});

// Orders the jobs release, fill or cancel reach open browsers as they do from the API.
const publisher = createRedisPublisher(config.redisUrl, log);
const updates = startOrderUpdatePublisher({ orders: deps.orders, publisher, log });

if (deps.quoteStreams) {
  const ready = await Promise.race([
    deps.quoteStreams.ready().then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), QUOTE_SNAPSHOT_WAIT_MS)),
  ]).catch(() => false);
  if (!ready) log.warn('the quote snapshots are not reachable; starting on opening prices');
}

const scheduler = await startJobScheduler({
  // BullMQ's worker blocks on its connection and needs maxRetriesPerRequest: null.
  connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
  jobs: createJobs({ orders: deps.orders, accounts: deps.repos.accounts }),
  log,
});
log.info('job worker started', { jobs: (await scheduler.queue.getJobSchedulers()).length });

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info('job worker stopping', { signal });
  // The running job finishes first; its commits and order updates are flushed before exit.
  void scheduler
    .close()
    .then(() => deps.orders.flushAudit())
    .then(() => {
      updates.stop();
      return publisher.close();
    })
    .then(() => deps.dispose())
    .then(() => stateRedis.quit())
    .then(
      () => process.exit(0),
      (error: unknown) => {
        log.warn('job worker shutdown failed', { error: String(error) });
        process.exit(1);
      },
    );
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
