import { describe, expect, it } from 'vitest';
import {
  HAND_WRITTEN_RELATIONS,
  compareRelations,
  isIgnoredSchema,
  schemaTableNames,
  type LiveRelation,
} from './liveSchemaCheck.js';

const table = (name: string, schema = 'public'): LiveRelation => ({
  schema,
  name,
  kind: 'r',
  isPartition: false,
});

describe('live schema check', () => {
  it('reads the table names from the Drizzle schema files', () => {
    const names = schemaTableNames();
    expect(names).toContain('users');
    expect(names).toContain('audit_log');
    expect(names).not.toContain('orders');
  });

  it('skips TimescaleDB catalog and internal schemas, Postgres catalogs and the migrator', () => {
    for (const schema of [
      '_timescaledb_catalog',
      '_timescaledb_internal',
      '_timescaledb_config',
      'timescaledb_information',
      'timescaledb_experimental',
      'pg_catalog',
      'information_schema',
      'pg_toast',
      'drizzle',
    ]) {
      expect(isIgnoredSchema(schema), schema).toBe(true);
    }
    expect(isIgnoredSchema('public')).toBe(false);
  });

  it('passes when the database has exactly the declared relations, ignoring chunks', () => {
    const live: LiveRelation[] = [
      table('users'),
      { schema: 'public', name: 'orders', kind: 'p', isPartition: false },
      { schema: 'public', name: 'orders_default', kind: 'r', isPartition: true },
      { schema: 'public', name: 'candles_5m', kind: 'v', isPartition: false },
      table('_hyper_1_1_chunk', '_timescaledb_internal'),
      table('_materialized_hypertable_2', '_timescaledb_internal'),
      table('__drizzle_migrations', 'drizzle'),
    ];
    expect(
      compareRelations(live, {
        tables: ['users'],
        handWritten: { orders: 'table', candles_5m: 'view' },
      }),
    ).toEqual([]);
  });

  it('reports missing, unexpected and mistyped relations', () => {
    const live = [table('users'), table('stray'), table('candles_5m'), table('x', 'other')];
    expect(
      compareRelations(live, {
        tables: ['users', 'watchlists'],
        handWritten: { candles_5m: 'view' },
      }),
    ).toEqual([
      'missing table public.watchlists',
      'public.candles_5m is a table, expected a view',
      'unexpected relation other.x outside public',
      'unexpected relation public.stray',
    ]);
  });

  it('lists the candle store among the hand-written relations', () => {
    expect(Object.keys(HAND_WRITTEN_RELATIONS)).toEqual(
      expect.arrayContaining(['candles_1m', 'candles_15m', 'candles_1d']),
    );
  });
});
