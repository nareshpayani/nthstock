import { Client } from 'pg';
import { beforeAll, expect, it } from 'vitest';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from '../test/testPostgres.js';
import { evaluateBudgets, renderReport } from './report.js';
import { recordClientQueries, runPerfSmoke } from './smoke.js';

// The perf smoke end to end on a small seed (T-243): every login and order succeeds, a rerun
// reuses the seeded users, and the report renders. The budgets themselves are judged by
// `npm run perf:smoke` on 10,000 users (CI's e2e-api job), not here beside other suites.

describeWithPostgres('perf smoke (integration, T-243)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
  }, 180_000);

  it('seeds, logs in with PINs, places MARKET orders and reports', async () => {
    await pg.truncate();
    const options = {
      databaseUrl: pg.appUrl,
      statsUrl: pg.adminUrl,
      users: 30,
      samples: 6,
      warmup: 2,
      concurrency: 2,
    };
    const first = await runPerfSmoke(options);
    expect(first.seed).toMatchObject({ users: 30, created: 30 });
    expect(first.failures).toEqual([]);
    expect(first.pinLogin).toMatchObject({ n: 6, errors: 0 });
    expect(first.orderAck).toMatchObject({ n: 6, errors: 0 });
    expect(first.clientQueries.length).toBeGreaterThan(0);
    // The test image may not preload pg_stat_statements: either way the smoke says which.
    if (!first.pgStatStatements.available) expect(first.pgStatStatements.reason).not.toBe('');
    expect(evaluateBudgets(first)).toHaveLength(3);
    expect(renderReport(first)).toContain('# Performance smoke (T-243)');

    const again = await runPerfSmoke(options);
    expect(again.seed.created).toBe(0);
    expect(again.failures).toEqual([]);
    expect(again.orderAck.errors).toBe(0);
  }, 120_000);

  it('reports why without a stats connection', async () => {
    await pg.truncate();
    const result = await runPerfSmoke({
      databaseUrl: pg.appUrl,
      statsUrl: null,
      users: 3,
      samples: 1,
      warmup: 0,
      concurrency: 1,
    });
    expect(result.pgStatStatements).toEqual({
      available: false,
      reason: 'no stats connection (set PERF_STATS_URL).',
    });
  }, 60_000);

  it('records a promise query and stops recording', async () => {
    const client = new Client({ connectionString: pg.adminUrl });
    await client.connect();
    try {
      const recorder = recordClientQueries();
      await client.query('select  1');
      await client.query({ text: 'select 2' });
      await expect(client.query('select nope')).rejects.toThrow();
      const samples = recorder.stop();
      expect([...samples.keys()].sort()).toEqual(['select 1', 'select 2', 'select nope']);
      await client.query('select 3');
      expect(samples.has('select 3')).toBe(false);
    } finally {
      await client.end();
    }
  });
});
