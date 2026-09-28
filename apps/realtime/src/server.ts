import { createRealtimeServer } from './app.js';
import { createJwtCookieAuthenticator, resolveJwtSecret } from './auth.js';
import { loadConfig } from './config.js';
import { createRedisQuoteFeed } from './feed.js';
import { jsonLogger } from './logger.js';
import { createRedisOrderFeed } from './orderFeed.js';
import { createRedisSessionRevocationFeed } from './sessionRevocationFeed.js';

const config = loadConfig(process.env);
const feed = createRedisQuoteFeed({ url: config.redisUrl, logger: jsonLogger });
const orderFeed = createRedisOrderFeed({ url: config.redisUrl, logger: jsonLogger });
const revocations = createRedisSessionRevocationFeed({ url: config.redisUrl, logger: jsonLogger });
const secret = resolveJwtSecret({
  value: config.jwtSecret,
  production: config.production,
  onEphemeral: () =>
    jsonLogger.warn(
      'JWT_SECRET is not set: using an ephemeral key, so no apps/api token will verify. Run npm run dev:api or set JWT_SECRET in both apps.',
    ),
});
// E2E only (T-162): NODE_ENV=test plus ENABLE_TEST_CONTROLS=true (loadConfig refuses the flag
// anywhere else) lets POST /v1/__test/clock move the clock tokens are checked against, in step
// with apps/api's test clock. Idle detection keeps real time.
let clockOffset = 0;
const tokenNow = () => Date.now() + clockOffset;
if (config.testControls) {
  jsonLogger.warn('ENABLE_TEST_CONTROLS: POST /v1/__test/clock is ON (NODE_ENV=test only).');
}
const server = createRealtimeServer({
  logger: jsonLogger,
  feed,
  orderFeed,
  revocations,
  authenticate: createJwtCookieAuthenticator({ secret, now: tokenNow }),
  ...(config.testControls
    ? {
        testControls: {
          setTime: (at: string) => {
            clockOffset = Date.parse(at) - Date.now();
          },
          now: tokenNow,
        },
      }
    : {}),
});

try {
  const port = await server.listen(config.port, config.host);
  jsonLogger.info('realtime listening', { host: config.host, port });
} catch (error) {
  jsonLogger.error('realtime failed to start', { error: String(error) });
  process.exit(1);
}

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
