import { createRealtimeServer } from './app.js';
import { loadConfig } from './config.js';
import { createRedisQuoteFeed } from './feed.js';
import { jsonLogger } from './logger.js';

const config = loadConfig(process.env);
const feed = createRedisQuoteFeed({ url: config.redisUrl, logger: jsonLogger });
const server = createRealtimeServer({ logger: jsonLogger, feed });

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
