import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** `apps/api/drizzle`, from both `src/db` (tsx, tests) and `dist/db` (built). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Where the migrator records what it applied (Drizzle's default). */
export const MIGRATIONS_TABLE = 'drizzle.__drizzle_migrations';

/**
 * Applies every migration in `apps/api/drizzle` that the database has not seen yet, in order, and
 * records each one; a second run applies nothing. Must run as the schema owner
 * (`DATABASE_MIGRATION_URL`, role nthstock_owner): the app role cannot run DDL.
 */
export async function runMigrations(url: string, folder = MIGRATIONS_FOLDER): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1, application_name: 'nthstock-migrate' });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
