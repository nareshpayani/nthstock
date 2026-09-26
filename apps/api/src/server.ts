import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);

const app = buildApp({
  logger: true,
  deps: { marketAlwaysOpen: config.mockMarketAlwaysOpen },
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
