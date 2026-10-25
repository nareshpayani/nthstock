import { Redis } from 'ioredis';
import { loadCandleWriterConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createPgCandleStore, startCandleWriter } from './modules/candles/index.js';

// The candle writer (spec market-data-and-matching §3, §7.2): an apps/api entry, like the job
// worker, that folds the tick streams apps/quotes writes into 1-minute bars in `candles_1m`. Run
// one process for all shards: `npm run dev:candles -w @nthstock/api`.

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

const config = loadCandleWriterConfig(process.env);
const database = createDatabase({
  url: config.databaseUrl,
  poolMax: 2,
  applicationName: 'nthstock-candles',
  onIdleError: (error) => log.warn('postgres pool error', { error: error.message }),
});
// XREADGROUP BLOCK holds the connection, so the writer has one of its own; commands queue while
// Redis reconnects, and the writer retries what fails.
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
let redisDown = false;
redis.on('error', (error: Error) => {
  if (!redisDown) log.warn('redis error', { error: error.message });
  redisDown = true;
});
redis.on('ready', () => {
  redisDown = false;
});

const writer = startCandleWriter({
  redis,
  store: createPgCandleStore({ database }),
  shards: config.shards,
  log,
});

const shutdown = () => {
  void writer
    .close()
    .then(() => database.close())
    .then(
      () => process.exit(0),
      (error: unknown) => {
        log.warn('candle writer shutdown failed', { error: String(error) });
        process.exit(1);
      },
    );
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
