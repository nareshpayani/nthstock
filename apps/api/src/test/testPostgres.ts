import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, Pool } from 'pg';
import { describe } from 'vitest';
import { runMigrations } from '../db/migrate.js';

/**
 * Real Postgres for integration tests (T-180), in the same shape as `testRedis.ts`.
 *
 * - Default (any machine with Docker): starts `postgres:16-alpine` with Testcontainers, once per
 *   test worker process. Testcontainers' reaper removes it when the run ends.
 * - `POSTGRES_TEST_URL=postgres://postgres:…@127.0.0.1:5432/postgres`: uses that server instead
 *   (CI's service container, `npm run infra:up`, or a local cluster). It must be a superuser: the
 *   helper creates the roles and one database per worker.
 * - `POSTGRES_TEST_POOLER_URL=postgres://127.0.0.1:6432` (optional, T-184): the app and purge
 *   roles connect through this PgBouncer (transaction mode) instead, like production; setup,
 *   migrations and truncation still go straight to Postgres.
 * - `SKIP_PG_INTEGRATION=1`: the only way to skip these suites, for a machine with neither. It is
 *   explicit, printed, and shows up as skipped tests in the Vitest summary. CI never sets it.
 *
 * Each worker gets its own database, `nthstock_test_api_<pool id>`, recreated when the worker
 * first asks for it: `infra/postgres/init.sql` creates the roles and database privileges, and the
 * migrations run once as nthstock_owner. Suites connect as `appUrl` (the DML-only role, like
 * apps/api) and call `truncate()` between tests, which runs as the owner because the app role
 * cannot truncate. Two test runs against one POSTGRES_TEST_URL at the same time would reuse each
 * other's database names, so run them one after the other.
 */
export type TestPostgres = {
  /** The per-worker database's name. */
  database: string;
  /** Superuser on that database: for tests that must act outside the roles. */
  adminUrl: string;
  /** nthstock_owner: DDL, migrations, truncation. */
  ownerUrl: string;
  /** nthstock_app: what apps/api connects as (DATABASE_URL). */
  appUrl: string;
  /** nthstock_purge: the account purge job's role. */
  purgeUrl: string;
  /** Empties every table in `public` (and restarts identities) as the owner. */
  truncate(): Promise<void>;
};

export const POSTGRES_TEST_IMAGE = 'postgres:16-alpine';

/** The non-secret local passwords from infra/postgres/init.sql. */
export const ROLE_PASSWORDS = {
  nthstock_owner: 'nthstock_owner_dev',
  nthstock_app: 'nthstock_app_dev',
  nthstock_purge: 'nthstock_purge_dev',
} as const;

export const INIT_SQL_PATH = fileURLToPath(
  new URL('../../../../infra/postgres/init.sql', import.meta.url),
);

const skip = process.env.SKIP_PG_INTEGRATION === '1';

/** `describe` for suites that need Postgres; skipped (loudly) only under SKIP_PG_INTEGRATION=1. */
export function describeWithPostgres(name: string, body: () => void) {
  if (skip) {
    process.stderr.write(
      `\n[postgres] SKIP_PG_INTEGRATION=1: skipping "${name}". CI runs it against Postgres.\n`,
    );
    describe.skip(name, body);
    return;
  }
  describe(name, body);
}

/** `url` with another user, password and database. */
export function withCredentials(
  url: string,
  change: { user?: string; password?: string; database?: string },
): string {
  const next = new URL(url);
  if (change.user !== undefined) next.username = change.user;
  if (change.password !== undefined) next.password = change.password;
  if (change.database !== undefined) next.pathname = `/${change.database}`;
  return next.toString();
}

/** `url` with the host and port of `other`. */
function withHostOf(url: string, other: string): string {
  const next = new URL(url);
  const { hostname, port } = new URL(other);
  next.hostname = hostname;
  next.port = port;
  return next.toString();
}

async function startServer(): Promise<string> {
  const external = process.env.POSTGRES_TEST_URL;
  if (external) return external;
  const { GenericContainer, Wait } = await import('testcontainers');
  try {
    const container = await new GenericContainer(POSTGRES_TEST_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'postgres_test', TZ: 'UTC' })
      .withExposedPorts(5432)
      // The image starts, runs its init, restarts: ready is logged twice.
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    return `postgres://postgres:postgres_test@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
  } catch (error) {
    throw new Error(
      'Postgres integration tests need Docker (Testcontainers). Start Docker, or set ' +
        'POSTGRES_TEST_URL to a running Postgres superuser URL, or set SKIP_PG_INTEGRATION=1 to ' +
        'skip them.',
      { cause: error },
    );
  }
}

async function withClient<T>(url: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function createTestDatabase(): Promise<TestPostgres> {
  const serverUrl = await startServer();
  const database = `nthstock_test_api_${process.env.VITEST_POOL_ID ?? String(process.pid)}`;
  await withClient(serverUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${database}"`);
  });
  const adminUrl = withCredentials(serverUrl, { database });
  const initSql = readFileSync(INIT_SQL_PATH, 'utf8');
  await withClient(adminUrl, (client) => client.query(initSql));
  const as = (user: keyof typeof ROLE_PASSWORDS) =>
    withCredentials(serverUrl, { user, password: ROLE_PASSWORDS[user], database });
  const pooler = process.env.POSTGRES_TEST_POOLER_URL;
  const pooled = (url: string) => (pooler ? withHostOf(url, pooler) : url);
  const ownerUrl = as('nthstock_owner');
  await runMigrations(ownerUrl);
  // One owner connection for truncation; it does not keep the worker alive.
  const owner = new Pool({ connectionString: ownerUrl, max: 1, allowExitOnIdle: true });
  owner.on('error', () => undefined);
  return {
    database,
    adminUrl,
    ownerUrl,
    appUrl: pooled(as('nthstock_app')),
    purgeUrl: pooled(as('nthstock_purge')),
    async truncate() {
      const { rows } = await owner.query<{ name: string }>(
        `select format('%I.%I', schemaname, tablename) as name
           from pg_tables where schemaname = 'public'`,
      );
      if (rows.length === 0) return;
      await owner.query(
        `TRUNCATE TABLE ${rows.map((row) => row.name).join(', ')} RESTART IDENTITY CASCADE`,
      );
    },
  };
}

const CACHE = Symbol.for('nthstock.testPostgres');
type Cache = { [CACHE]?: Promise<TestPostgres> | undefined };

/**
 * The worker's migrated test database, created on first use and shared by every suite the worker
 * runs afterwards (a failed start is not cached, so the next suite retries).
 */
export function useTestPostgres(): Promise<TestPostgres> {
  const cache = globalThis as Cache;
  const existing = cache[CACHE];
  if (existing) return existing;
  const created = createTestDatabase();
  cache[CACHE] = created;
  created.catch(() => {
    if (cache[CACHE] === created) cache[CACHE] = undefined;
  });
  return created;
}
