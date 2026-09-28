import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp, type App, type AppOptions } from '../app.js';
import { createDatabase, type Database } from '../db/client.js';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from './testPostgres.js';
import { describeWithRedis, startTestRedis, uniqueChannel, type TestRedis } from './testRedis.js';

/**
 * apps/api as it runs with `DB_DRIVER=postgres`: Postgres through the app role and Redis for
 * short-lived auth state, for integration tests that need both (T-193 onwards). Skipped only under
 * SKIP_PG_INTEGRATION=1 or SKIP_REDIS_INTEGRATION=1.
 */
export type PostgresRedisHarness = {
  pg: () => TestPostgres;
  database: () => Database;
  redis: () => Redis;
  /** This test's Redis key namespace (fresh before every test). */
  prefix: () => string;
  /** An app instance on the shared Postgres and Redis; closed after the suite. */
  app: (options?: AppOptions) => App;
};

export function describeWithPostgresAndRedis(
  name: string,
  body: (harness: PostgresRedisHarness) => void,
): void {
  describeWithPostgres(name, () => {
    describeWithRedis('with Redis', () => {
      let pg: TestPostgres | undefined;
      let database: Database | undefined;
      let server: TestRedis | undefined;
      let redis: Redis | undefined;
      let prefix = '';
      const apps: App[] = [];

      beforeAll(async () => {
        pg = await useTestPostgres();
        database = createDatabase({ url: pg.appUrl, poolMax: 8 });
        server = await startTestRedis();
        redis = new Redis(server.url, { maxRetriesPerRequest: 2 });
      }, 180_000);

      afterAll(async () => {
        await Promise.all(apps.map((app) => app.close()));
        await redis?.quit();
        await server?.stop();
        await database?.close();
      });

      beforeEach(async () => {
        await need(pg).truncate();
        prefix = `${uniqueChannel('test:api')}:`;
      });

      body({
        pg: () => need(pg),
        database: () => need(database),
        redis: () => need(redis),
        prefix: () => prefix,
        app: (options = {}) => {
          const app = buildApp({
            orderSweepMs: null,
            ...options,
            deps: {
              database: need(database),
              redis: need(redis),
              redisKeyPrefix: prefix,
              ...options.deps,
            },
          });
          apps.push(app);
          return app;
        },
      });
    });
  });
}

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Postgres and Redis harness used outside a test');
  return value;
}
