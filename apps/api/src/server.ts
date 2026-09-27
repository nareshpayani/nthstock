import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { resolveJwtSecret } from './modules/auth/jwtSecret.js';
import { seedDemo } from './modules/demo/seed.js';
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
  deps: {
    marketAlwaysOpen: config.mockMarketAlwaysOpen,
    production: config.production,
    jwtSecret,
    ...(testClock ? { clock: testClock } : {}),
    // The mock SMS provider's dev log line (the OTP, outside production only).
    smsLog: (line) => process.stdout.write(`${line}\n`),
  },
  ...(publisher ? { tickPublisher: publisher, orderPublisher: publisher } : {}),
  ...(testClock ? { testControls: { setTime: testClock.set } } : {}),
});

app.addHook('onClose', async () => {
  await rateLimitRedis?.quit();
});

try {
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
