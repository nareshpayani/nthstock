import { z } from 'zod';
import { runMigrations } from './migrate.js';

// `npm run db:migrate -w @nthstock/api`: applies pending migrations as the schema owner.
// Only reads DATABASE_MIGRATION_URL (never DATABASE_URL, whose role cannot run DDL).
const url = z
  .url({ protocol: /^postgres(ql)?$/ })
  .safeParse(process.env.DATABASE_MIGRATION_URL?.trim());

if (!url.success) {
  process.stderr.write(
    'DATABASE_MIGRATION_URL must be a postgres:// URL for the nthstock_owner role ' +
      '(see apps/api/.env.example).\n',
  );
  process.exit(1);
}

try {
  await runMigrations(url.data);
  process.stdout.write('Migrations are up to date.\n');
} catch (error) {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
