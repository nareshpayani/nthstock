import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { describe } from 'vitest';

/**
 * Real Postgres for the matcher's integration tests, the same way apps/api's `testPostgres.ts`
 * gets it: `POSTGRES_TEST_URL` (a superuser URL: CI's service, `npm run infra:up`, a local
 * cluster) or a Testcontainers `postgres:16-alpine`. The database is built by the real
 * `infra/postgres/init.sql` and apps/api's migrations, so the matcher reads the schema it will
 * meet. `SKIP_PG_INTEGRATION=1` skips the suites, loudly.
 */
export type TestPostgres = {
  /** nthstock_owner: seeds rows the way apps/api would have written them. */
  ownerUrl: string;
  /** nthstock_app: what the matcher connects as (DATABASE_URL). */
  appUrl: string;
};

const INIT_SQL = fileURLToPath(new URL('../../../../infra/postgres/init.sql', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../../api/drizzle', import.meta.url));
/** The non-secret local passwords from infra/postgres/init.sql. */
const PASSWORDS = { nthstock_owner: 'nthstock_owner_dev', nthstock_app: 'nthstock_app_dev' };

const skip = process.env.SKIP_PG_INTEGRATION === '1';

export function describeWithPostgres(name: string, body: () => void) {
  if (skip) {
    process.stderr.write(`\n[postgres] SKIP_PG_INTEGRATION=1: skipping "${name}".\n`);
    describe.skip(name, body);
    return;
  }
  describe(name, body);
}

function withCredentials(url: string, user: string, password: string, database: string): string {
  const next = new URL(url);
  next.username = user;
  next.password = password;
  next.pathname = `/${database}`;
  return next.toString();
}

async function serverUrl(): Promise<string> {
  const external = process.env.POSTGRES_TEST_URL;
  if (external) return external;
  const { GenericContainer, Wait } = await import('testcontainers');
  const container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'postgres_test', TZ: 'UTC' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  return `postgres://postgres:postgres_test@${container.getHost()}:${String(container.getMappedPort(5432))}/postgres`;
}

async function run(url: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** A fresh, migrated database for this worker. */
export async function startTestPostgres(): Promise<TestPostgres> {
  const server = await serverUrl();
  const database = `nthstock_test_matcher_${process.env.VITEST_POOL_ID ?? String(process.pid)}`;
  await run(server, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await run(server, `CREATE DATABASE "${database}"`);
  const admin = new URL(server);
  admin.pathname = `/${database}`;
  await run(admin.toString(), readFileSync(INIT_SQL, 'utf8'));
  const ownerUrl = withCredentials(server, 'nthstock_owner', PASSWORDS.nthstock_owner, database);
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }
  return {
    ownerUrl,
    appUrl: withCredentials(server, 'nthstock_app', PASSWORDS.nthstock_app, database),
  };
}
