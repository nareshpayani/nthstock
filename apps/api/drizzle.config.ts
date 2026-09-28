import { defineConfig } from 'drizzle-kit';

// drizzle-kit (ADR 0007): `npm run db:generate` writes SQL migrations from the schema files into
// ./drizzle, and `npm run db:check` fails when they drift. Neither needs a database. Migrations are
// applied by `npm run db:migrate` (src/db/migrateCli.ts) with DATABASE_MIGRATION_URL, never by
// drizzle-kit, so the URL here is only for ad-hoc drizzle-kit commands (e.g. studio).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_MIGRATION_URL ??
      'postgres://nthstock_owner:nthstock_owner_dev@127.0.0.1:5432/nthstock',
  },
  strict: true,
  verbose: true,
});
