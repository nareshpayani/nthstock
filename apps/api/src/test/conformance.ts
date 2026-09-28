import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { createDatabase, type Database } from '../db/client.js';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from './testPostgres.js';

/**
 * Repo conformance harness (T-183, spec backend-core §5.1): one shared suite per repo interface,
 * run against the memory implementation and the Postgres one, so the two cannot drift.
 *
 *   describeRepoConformance('users repo', {
 *     memory: () => createMemoryUsersRepo({ clock }),
 *     postgres: (database) => createPgUsersRepo({ database, clock }),
 *   }, ({ repo }) => {
 *     it('finds a user by mobile', async () => { … repo() … });
 *   });
 *
 * Each implementation gets a fresh repo before every test. The Postgres run connects as
 * nthstock_app (like apps/api) to the worker's migrated test database and truncates every table
 * first; it is skipped only under SKIP_PG_INTEGRATION=1 (see testPostgres.ts).
 */
export type RepoDriver = 'memory' | 'postgres';

export type RepoFactories<R> = {
  memory: () => R | Promise<R>;
  /** Builds the Postgres repo on the harness's shared app-role connection. */
  postgres: (database: Database) => R | Promise<R>;
  /**
   * Once per Postgres run, before the first test, as the owner: fixtures a suite needs beyond the
   * migrations. Real repos need none; their tables come from migrations.
   */
  preparePostgres?: (pg: TestPostgres) => Promise<void>;
};

export type ConformanceContext<R> = {
  driver: RepoDriver;
  /** The repo for the running test. */
  repo: () => R;
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
    suite({ driver: 'memory', repo: () => current(repo) });
  });

  describeWithPostgres(`${name} [postgres]`, () => {
    let pg: TestPostgres;
    let database: Database | undefined;
    let repo: R | undefined;
    beforeAll(async () => {
      pg = await useTestPostgres();
      await factories.preparePostgres?.(pg);
      database = createDatabase({ url: pg.appUrl, poolMax: 4 });
    }, 180_000);
    afterAll(async () => {
      await database?.close();
    });
    beforeEach(async () => {
      await pg.truncate();
      repo = await factories.postgres(current(database));
    });
    suite({ driver: 'postgres', repo: () => current(repo) });
  });
}

function current<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Conformance repo used outside a test');
  return value;
}
