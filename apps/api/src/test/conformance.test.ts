import { eq, sql } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import type { Database } from '../db/client.js';
import { describeRepoConformance } from './conformance.js';

// A sample repo interface run through the harness (T-183): counters that must stay exact under
// concurrency, the kind of guarantee every real repo's suite checks on both implementations.

type CounterRepo = {
  increment(key: string): Promise<number>;
  get(key: string): Promise<number>;
};

function createMemoryCounterRepo(): CounterRepo {
  const counts = new Map<string, number>();
  return {
    increment: (key) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    get: (key) => Promise.resolve(counts.get(key) ?? 0),
  };
}

// Test-only table, created by preparePostgres: not in src/db/schema, so no migration.
const counters = pgTable('conformance_sample_counters', {
  key: text().primaryKey(),
  value: integer().notNull(),
});

function createPgCounterRepo(database: Database): CounterRepo {
  return {
    async increment(key) {
      // One atomic statement, so concurrent increments never lose an update.
      const [row] = await database.db
        .insert(counters)
        .values({ key, value: 1 })
        .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
        .returning({ value: counters.value });
      if (!row) throw new Error('increment returned no row');
      return row.value;
    },
    async get(key) {
      const [row] = await database.db
        .select({ value: counters.value })
        .from(counters)
        .where(eq(counters.key, key));
      return row?.value ?? 0;
    },
  };
}

const drivers: string[] = [];

describeRepoConformance(
  'sample counter repo',
  {
    memory: createMemoryCounterRepo,
    postgres: createPgCounterRepo,
    preparePostgres: async (pg) => {
      const { Client } = await import('pg');
      const owner = new Client({ connectionString: pg.ownerUrl });
      await owner.connect();
      try {
        await owner.query(
          'CREATE TABLE IF NOT EXISTS conformance_sample_counters (key text PRIMARY KEY, value integer NOT NULL)',
        );
      } finally {
        await owner.end();
      }
    },
  },
  ({ driver, repo }) => {
    it('starts every test empty', async () => {
      drivers.push(driver);
      expect(await repo().get('a')).toBe(0);
      expect(await repo().increment('a')).toBe(1);
    });

    it('keeps counters apart', async () => {
      await repo().increment('a');
      await repo().increment('a');
      await repo().increment('b');

      expect(await repo().get('a')).toBe(2);
      expect(await repo().get('b')).toBe(1);
    });

    it('counts 20 concurrent increments exactly', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => repo().increment('c')));

      expect(results.toSorted((x, y) => x - y)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      expect(await repo().get('c')).toBe(20);
    });
  },
);

it('runs the suite once per driver (unless Postgres is skipped)', () => {
  const expected = process.env.SKIP_PG_INTEGRATION === '1' ? ['memory'] : ['memory', 'postgres'];
  expect(drivers).toEqual(expected);
});
