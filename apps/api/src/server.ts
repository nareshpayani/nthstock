import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createRedisPublisher } from './ticks/publisher.js';

const config = loadConfig(process.env);

// Ticks go to Redis only when REDIS_URL is set (npm run dev:api); otherwise REST only.
const tickLog = {
  info: (message: string) => process.stdout.write(`${message}\n`),
  warn: (message: string) => process.stderr.write(`${message}\n`),
};

const app = buildApp({
  logger: true,
  deps: { marketAlwaysOpen: config.mockMarketAlwaysOpen },
  ...(config.redisUrl ? { tickPublisher: createRedisPublisher(config.redisUrl, tickLog) } : {}),
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
