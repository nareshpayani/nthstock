import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { resolveJwtSecret } from './modules/auth/jwtSecret.js';
import { seedDemo } from './modules/demo/seed.js';
import { DEMO_USER } from './modules/users/repo.js';
import { offsetClock } from './modules/testControls/offsetClock.js';
import { createRedisPublisher } from './ticks/publisher.js';

const config = loadConfig(process.env);

// Ticks go to Redis only when REDIS_URL is set (npm run dev:api); otherwise REST only.
const tickLog = {
  info: (message: string) => process.stdout.write(`${message}\n`),
  warn: (message: string) => process.stderr.write(`${message}\n`),
};

const jwtSecret = resolveJwtSecret({
  value: config.jwtSecret,
  production: config.production,
  onEphemeral: () =>
    process.stderr.write(
      'JWT_SECRET is not set: using an ephemeral dev key; sessions end when apps/api restarts.\n',
    ),
});

// Rate-limit counters shared by every API instance when Redis is configured (T-082).
const rateLimitRedis = config.redisUrl
  ? new Redis(config.redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
  : null;

// Short-lived auth state for DB_DRIVER=postgres (OTP challenges, T-193; the session revocation
// cache and event, T-194), so apps/api holds none.
// Commands queue while it connects, unlike the rate-limit client, which fails fast.
const stateRedis =
  config.dbDriver === 'postgres' && config.redisUrl
    ? new Redis(config.redisUrl, { maxRetriesPerRequest: 2 })
    : null;

// One Redis publisher carries ticks and per-user order updates (T-133).
const publisher = config.redisUrl ? createRedisPublisher(config.redisUrl, tickLog) : null;

// E2E only (T-162): NODE_ENV=test plus ENABLE_TEST_CONTROLS=true (loadConfig refuses the flag
// anywhere else) swaps in a clock the /v1/__test routes can move.
const testClock = config.testControls ? offsetClock() : null;
if (testClock) {
  process.stderr.write(
    'ENABLE_TEST_CONTROLS: /v1/__test clock and price routes are ON (NODE_ENV=test only).\n',
  );
}

const app = buildApp({
  logger: true,
  ...(rateLimitRedis ? { rateLimitRedis } : {}),
  // GET /v1/health/ready pings the same Redis client; Postgres is checked through deps.database.
  ...(rateLimitRedis ? { redisReadiness: () => rateLimitRedis.ping() } : {}),
  deps: {
    // DB_DRIVER=postgres (npm run dev:api, E2E; T-182) opens one pool as nthstock_app.
    dbDriver: config.dbDriver,
    ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
    pgPoolMax: config.pgPoolMax,
    ...(stateRedis ? { redis: stateRedis } : {}),
    onDatabaseError: (error) => process.stderr.write(`postgres pool error: ${error.message}\n`),
    marketAlwaysOpen: config.mockMarketAlwaysOpen,
    production: config.production,
    jwtSecret,
    // PII_ENC_KEYS and PII_HMAC_KEY for the Postgres repos (T-189); development keys when unset.
    piiKeys: config.pii.keys,
    ...(testClock ? { clock: testClock } : {}),
    // The mock SMS provider's dev log line (the OTP, outside production only).
    smsLog: (line) => process.stdout.write(`${line}\n`),
  },
  ...(publisher ? { tickPublisher: publisher, orderPublisher: publisher } : {}),
  ...(testClock ? { testControls: { setTime: testClock.set } } : {}),
});

app.addHook('onClose', async () => {
  await rateLimitRedis?.quit();
  await stateRedis?.quit();
});

if (config.dbDriver === 'postgres' && config.pii.devKeys) {
  app.log.warn('PII_ENC_KEYS and PII_HMAC_KEY are not set: using the throwaway development keys.');
}

try {
  // The demo user (mobile 9000000001) exists outside production on every driver, as it always has
  // in memory and in msw mode; on Postgres it is stored once (T-190).
  if (!config.production) await app.deps.repos.users.ensureSeeded(DEMO_USER);
  // npm run seed:demo (T-174): the demo user's watchlists, holdings and ledger, before any request.
  if (config.demoSeed) {
    await seedDemo(app.deps);
    app.log.info('DEMO_SEED: demo watchlists and paper account loaded for mobile 9000000001.');
  }
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
