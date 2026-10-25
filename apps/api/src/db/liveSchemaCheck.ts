import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import * as alerts from './schema/alerts.js';
import * as audit from './schema/audit.js';
import * as auth from './schema/auth.js';
import * as notifications from './schema/notifications.js';
import * as paper from './schema/paper.js';
import * as users from './schema/users.js';
import * as watchlists from './schema/watchlists.js';

/**
 * Relations that hand-written migrations create, outside `src/db/schema` (drizzle-kit cannot
 * express them): the partitioned order tables (0011) and the TimescaleDB candle store (0014).
 */
export const HAND_WRITTEN_RELATIONS: Readonly<Record<string, 'table' | 'view'>> = {
  orders: 'table',
  order_events: 'table',
  candles_1m: 'table',
  candles_5m: 'view',
  candles_15m: 'view',
  candles_30m: 'view',
  candles_1h: 'view',
  candles_1d: 'view',
};

/** Every table the Drizzle schema files declare. */
export function schemaTableNames(): string[] {
  const modules = [alerts, audit, auth, notifications, paper, users, watchlists];
  return modules
    .flatMap((module) => Object.values(module))
    .filter((value): value is PgTable => value instanceof PgTable)
    .map((table) => getTableConfig(table).name)
    .sort();
}

/** A relation as `pg_class` lists it. */
export type LiveRelation = {
  schema: string;
  name: string;
  /** `r` table, `p` partitioned table, `v` view, `m` materialised view. */
  kind: string;
  /** A partition of a partitioned table (`orders_default`, a daily partition). */
  isPartition: boolean;
};

/**
 * Schemas the check never looks at: Postgres's own, and TimescaleDB's catalog and internals
 * (`_timescaledb_catalog`, `_timescaledb_internal` with every chunk and materialisation table,
 * `timescaledb_information`, `timescaledb_experimental`), plus the migrator's `drizzle`.
 */
export function isIgnoredSchema(schema: string): boolean {
  return (
    schema === 'pg_catalog' ||
    schema === 'information_schema' ||
    schema.startsWith('pg_toast') ||
    schema.startsWith('pg_temp') ||
    schema.startsWith('_timescaledb_') ||
    schema.startsWith('timescaledb_') ||
    schema === 'toolkit_experimental' ||
    schema === 'drizzle'
  );
}

/**
 * What differs between a migrated database and the schema files plus the hand-written relations:
 * a relation nobody declared (a hand edit, or a migration whose objects are not listed here) or a
 * declared one that is missing (a migration not applied). Partitions and TimescaleDB's own objects
 * are skipped. Returns one line per problem; empty when they match.
 */
export function compareRelations(
  live: readonly LiveRelation[],
  expected: { tables: readonly string[]; handWritten: Readonly<Record<string, 'table' | 'view'>> },
): string[] {
  const found = new Map<string, 'table' | 'view'>();
  const problems: string[] = [];
  for (const relation of live) {
    if (isIgnoredSchema(relation.schema) || relation.isPartition) continue;
    const qualified = `${relation.schema}.${relation.name}`;
    if (relation.schema !== 'public') {
      problems.push(`unexpected relation ${qualified} outside public`);
      continue;
    }
    found.set(relation.name, relation.kind === 'v' || relation.kind === 'm' ? 'view' : 'table');
  }
  const wanted = new Map<string, 'table' | 'view'>(
    expected.tables.map((name) => [name, 'table' as const]),
  );
  for (const [name, kind] of Object.entries(expected.handWritten)) wanted.set(name, kind);
  for (const [name, kind] of wanted) {
    const actual = found.get(name);
    if (!actual) problems.push(`missing ${kind} public.${name}`);
    else if (actual !== kind) problems.push(`public.${name} is a ${actual}, expected a ${kind}`);
  }
  for (const name of found.keys()) {
    if (!wanted.has(name)) problems.push(`unexpected relation public.${name}`);
  }
  return problems.sort();
}

/** Reads the database's relations and compares them (see `compareRelations`). */
export async function checkLiveSchema(url: string): Promise<string[]> {
  const client = new Client({ connectionString: url, application_name: 'nthstock-db-check' });
  await client.connect();
  try {
    const { rows } = await client.query<LiveRelation>(
      `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
              c.relispartition AS "isPartition"
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm')`,
    );
    return compareRelations(rows, {
      tables: schemaTableNames(),
      handWritten: HAND_WRITTEN_RELATIONS,
    });
  } finally {
    await client.end();
  }
}
