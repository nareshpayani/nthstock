import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe } from 'vitest';
import { createDatabase, type Database } from '../db/client.js';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from './testPostgres.js';
import { describeWithRedis, startTestRedis, type TestRedis } from './testRedis.js';

/**
 * Repo conformance harness (T-183, spec backend-core §5.1): one shared suite per repo interface,
 * run against the memory implementation and the Postgres one (and, for stores that live in Redis,
 * the Redis one; T-193), so they cannot drift.
 *
 *   describeRepoConformance('users repo', {
 *     memory: () => createMemoryUsersRepo({ clock }),
 *     postgres: (database) => createPgUsersRepo({ database, clock }),
 *   }, ({ repo }) => {
 *     it('finds a user by mobile', async () => { … repo() … });
 *   });
 *
 * Each implementation gets a fresh repo before every test.
 * - Postgres connects as nthstock_app (like apps/api) to the worker's migrated test database and
 *   truncates every table first; skipped only under SKIP_PG_INTEGRATION=1 (see testPostgres.ts).
 * - Redis shares one client per suite; the factory keeps tests apart (e.g. a unique key prefix).
 *   Skipped only under SKIP_REDIS_INTEGRATION=1 (see testRedis.ts).
 */
export type RepoDriver = 'memory' | 'postgres' | 'redis';

export type RepoFactories<R> = {
  memory: () => R | Promise<R>;
  /** Builds the Postgres repo on the harness's shared app-role connection. */
  postgres?: (database: Database) => R | Promise<R>;
  /**
   * Once per Postgres run, before the first test, as the owner: fixtures a suite needs beyond the
   * migrations. Real repos need none; their tables come from migrations.
   */
  preparePostgres?: (pg: TestPostgres) => Promise<void>;
  /** Builds the Redis implementation on the harness's shared client. */
  redis?: (client: Redis) => R | Promise<R>;
};

export type ConformanceContext<R> = {
  driver: RepoDriver;
  /** The repo for the running test. */
  repo: () => R;
  /** The shared app-role connection; only in the Postgres run. */
  database: () => Database;
  /** The shared client; only in the Redis run. */
  redis: () => Redis;
};

const unavailable = (what: string, driver: RepoDriver) => () => {
  throw new Error(`${what} is not available in the ${driver} run`);
};

export function describeRepoConformance<R>(
  name: string,
  factories: RepoFactories<R>,
  suite: (context: ConformanceContext<R>) => void,
): void {
  describe(`${name} [memory]`, () => {
    let repo: R | undefined;
    beforeEach(async () => {
      repo = await factories.memory();
    });
    suite({
      driver: 'memory',
      repo: () => current(repo),
      database: unavailable('database()', 'memory'),
      redis: unavailable('redis()', 'memory'),
    });
  });

  const postgres = factories.postgres;
  if (postgres) {
    describeWithPostgres(`${name} [postgres]`, () => {
      let pg: TestPostgres;
      let database: Database | undefined;
      let repo: R | undefined;
      beforeAll(async () => {
        pg = await useTestPostgres();
        await factories.preparePostgres?.(pg);
        database = createDatabase({ url: pg.appUrl, poolMax: 8 });
      }, 180_000);
      afterAll(async () => {
        await database?.close();
      });
      beforeEach(async () => {
        await pg.truncate();
        repo = await postgres(current(database));
      });
      suite({
        driver: 'postgres',
        repo: () => current(repo),
        database: () => current(database),
        redis: unavailable('redis()', 'postgres'),
      });
    });
  }

  const redis = factories.redis;
  if (redis) {
    describeWithRedis(`${name} [redis]`, () => {
      let server: TestRedis | undefined;
      let client: Redis | undefined;
      let repo: R | undefined;
      beforeAll(async () => {
        server = await startTestRedis();
        client = new Redis(server.url, { maxRetriesPerRequest: 1 });
      }, 180_000);
      afterAll(async () => {
        await client?.quit();
        await server?.stop();
      });
      beforeEach(async () => {
        repo = await redis(current(client));
      });
      afterEach(() => {
        repo = undefined;
      });
      suite({
        driver: 'redis',
        repo: () => current(repo),
        database: unavailable('database()', 'redis'),
        redis: () => current(client),
      });
    });
  }
}

function current<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Conformance repo used outside a test');
  return value;
}
