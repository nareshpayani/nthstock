import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from '../test/testPostgres.js';
import { checkLiveSchema } from './liveSchemaCheck.js';

// db:check's live step (NSTOCK-0376) on a migrated TimescaleDB database with chunks and
// materialised aggregates in it.

describeWithPostgres('live schema check (integration)', () => {
  let pg: TestPostgres;
  let owner: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    owner = new Client({ connectionString: pg.ownerUrl });
    await owner.connect();
  }, 180_000);

  afterAll(async () => {
    await owner.query('DROP TABLE IF EXISTS stray_table');
    await pg.truncate();
    await owner.end();
  });

  it('passes on the migrated database with chunks and materialised aggregates', async () => {
    await owner.query(
      `INSERT INTO candles_1m (token, bucket, open, high, low, close, volume)
       SELECT 7, minute, 100, 110, 90, 105, 1
         FROM generate_series('2026-10-20T03:45:00Z'::timestamptz, '2026-10-23T03:50:00Z',
                              interval '1 hour') AS minute`,
    );
    await owner.query(`CALL refresh_continuous_aggregate('candles_1h', NULL, NULL)`);
    const { rows } = await owner.query<{ chunks: string }>(
      `select count(*) as chunks from timescaledb_information.chunks`,
    );
    expect(Number(rows[0]?.chunks)).toBeGreaterThan(1);

    expect(await checkLiveSchema(pg.appUrl)).toEqual([]);
  });

  it('fails on a table no migration declares', async () => {
    await owner.query('CREATE TABLE stray_table (id int)');
    expect(await checkLiveSchema(pg.appUrl)).toEqual(['unexpected relation public.stray_table']);
    await owner.query('DROP TABLE stray_table');
  });
});
