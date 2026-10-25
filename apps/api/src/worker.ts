import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { createDeps } from './deps.js';
import { createJobs, safeErrorMessage, startJobScheduler } from './modules/jobs/index.js';
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
  error(message: string, fields: Record<string, unknown> = {}) {
    process.stderr.write(
      `${JSON.stringify({ level: 50, time: Date.now(), msg: message, ...fields })}\n`,
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
  onDatabaseError: (error) => log.warn('postgres pool error', { error: safeErrorMessage(error) }),
  marketAlwaysOpen: config.mockMarketAlwaysOpen,
  // Square-off fills at the prices the API sees: the quote service's, when it runs.
  ...(config.quoteShards !== null
    ? { quoteStreams: { url: config.redisUrl, shards: config.quoteShards, log } }
    : {}),
  // Under MATCHER_MODE=worker the matcher owns resting orders, so these engines must not match.
  matcherMode: config.matcherMode,
  production: config.production,
  piiKeys: config.pii.keys,
  // Errors are reported as their classes and SQLSTATE only (no PII in logs).
  onAuditError: (error) => log.warn('orders background error', { error: safeErrorMessage(error) }),
});

// Orders the jobs release, fill or cancel reach open browsers as they do from the API.
const publisher = createRedisPublisher(config.redisUrl, log);
const updates = startOrderUpdatePublisher({ orders: deps.orders, publisher, log });

// On the quote service, session jobs that fill orders refuse to run (and so retry) until the
// worker has the live prices: a square-off on opening prices would fill at the wrong price.
let pricesLive = deps.quoteStreams === null;
const quoteStreams = deps.quoteStreams;
if (quoteStreams) {
  const live = (async () => {
    for (;;) {
      try {
        await quoteStreams.ready();
        pricesLive = true;
        return true;
      } catch (error) {
        log.warn('reading the quote snapshots failed; trying again', {
          error: error instanceof Error ? error.name : 'non-error thrown',
        });
        await new Promise((resolve) => setTimeout(resolve, QUOTE_SNAPSHOT_WAIT_MS));
      }
    }
  })();
  const ready = await Promise.race([
    live,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), QUOTE_SNAPSHOT_WAIT_MS)),
  ]);
  if (!ready) log.warn('the quote snapshots are not reachable yet; session jobs wait for them');
}

const scheduler = await startJobScheduler({
  // BullMQ's worker blocks on its connection and needs maxRetriesPerRequest: null.
  connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
  jobs: createJobs({
    orders: deps.orders,
    accounts: deps.repos.accounts,
    pricesLive: () => pricesLive,
    pnlSnapshots: deps.repos.pnlSnapshots,
    database: deps.database,
    auth: deps.repos.auth,
  }),
  log,
  // Tests keep their queues apart; one deployment uses the default.
  ...(process.env.JOBS_PREFIX ? { prefix: process.env.JOBS_PREFIX } : {}),
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
        log.warn('job worker shutdown failed', { error: safeErrorMessage(error) });
        process.exit(1);
      },
    );
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
