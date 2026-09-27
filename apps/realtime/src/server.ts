import { createRealtimeServer } from './app.js';
import { createJwtCookieAuthenticator, resolveJwtSecret } from './auth.js';
import { loadConfig } from './config.js';
import { createRedisQuoteFeed } from './feed.js';
import { jsonLogger } from './logger.js';
import { createRedisOrderFeed } from './orderFeed.js';

const config = loadConfig(process.env);
const feed = createRedisQuoteFeed({ url: config.redisUrl, logger: jsonLogger });
const orderFeed = createRedisOrderFeed({ url: config.redisUrl, logger: jsonLogger });
const secret = resolveJwtSecret({
  value: config.jwtSecret,
  production: config.production,
  onEphemeral: () =>
    jsonLogger.warn(
      'JWT_SECRET is not set: using an ephemeral key, so no apps/api token will verify. Run npm run dev:api or set JWT_SECRET in both apps.',
    ),
});
const server = createRealtimeServer({
  logger: jsonLogger,
  feed,
  orderFeed,
  authenticate: createJwtCookieAuthenticator({ secret }),
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
