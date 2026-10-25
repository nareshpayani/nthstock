import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from '../test/testPostgres.js';

// The TimescaleDB candle store as migration 0014 builds it (NSTOCK-0371, NSTOCK-0372, spec
// market-data-and-matching §7.1 and §7.4).

const AGGREGATES = ['candles_5m', 'candles_15m', 'candles_30m', 'candles_1h', 'candles_1d'];

describeWithPostgres('candle tables (integration)', () => {
  let pg: TestPostgres;
  let app: Client;
  let owner: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    app = new Client({ connectionString: pg.appUrl });
    owner = new Client({ connectionString: pg.ownerUrl });
    await Promise.all([app.connect(), owner.connect()]);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([app.end(), owner.end()]);
  });

  beforeEach(async () => {
    await pg.truncate();
    // Truncating candles_1m leaves what a policy job already materialised from the previous test;
    // refreshing the now-empty range drops it so every test starts from empty aggregates.
    for (const name of AGGREGATES) {
      await owner.query(`CALL refresh_continuous_aggregate('${name}', NULL, NULL)`);
    }
  });

  /** One bar a minute for token 1 from `from` to `to` (inclusive), each with volume 10. */
  const insertMinutes = (from: string, to: string) =>
    app.query(
      `INSERT INTO candles_1m (token, bucket, open, high, low, close, volume)
       SELECT 1, minute, 10000 + n, 10100 + n, 9900 + n, 10050 + n, 10
         FROM generate_series($1::timestamptz, $2::timestamptz, interval '1 minute')
              WITH ORDINALITY AS g(minute, n)`,
      [from, to],
    );

  it('creates the extension, a hypertable with 1-day chunks, compression and the policies', async () => {
    const { rows: ext } = await owner.query(
      `select 1 from pg_extension where extname = 'timescaledb'`,
    );
    expect(ext).toHaveLength(1);

    const { rows: dims } = await owner.query<{ interval: string }>(
      `select time_interval::text as interval from timescaledb_information.dimensions
        where hypertable_name = 'candles_1m'`,
    );
    expect(dims).toEqual([{ interval: '1 day' }]);

    const { rows: compression } = await owner.query<{ attname: string; segment: number | null }>(
      `select attname, segmentby_column_index as segment
         from timescaledb_information.compression_settings
        where hypertable_name = 'candles_1m' and segmentby_column_index is not null`,
    );
    expect(compression.map((row) => row.attname)).toEqual(['token']);

    const { rows: jobs } = await owner.query<{ proc: string; target: string }>(
      `select proc_name as proc, hypertable_name as target from timescaledb_information.jobs
        where proc_name in ('policy_compression', 'policy_refresh_continuous_aggregate')`,
    );
    expect(jobs.filter((job) => job.proc === 'policy_compression')).toHaveLength(1);
    const { rows: views } = await owner.query<{ name: string; realtime: boolean }>(
      `select view_name as name, not materialized_only as realtime
         from timescaledb_information.continuous_aggregates order by view_name`,
    );
    expect(views.map((view) => view.name).sort()).toEqual([...AGGREGATES].sort());
    expect(views.every((view) => view.realtime)).toBe(true);
    expect(jobs.filter((job) => job.proc === 'policy_refresh_continuous_aggregate')).toHaveLength(
      AGGREGATES.length,
    );
  });

  it('starts 15-minute bars at 09:15, 09:30 IST and an hourly bar at 09:15 IST', async () => {
    // 2026-10-23 09:15 to 10:44 IST.
    await insertMinutes('2026-10-23T03:45:00Z', '2026-10-23T05:14:00Z');

    const { rows: quarters } = await app.query<{ bucket: Date; open: string; volume: string }>(
      `select bucket, open, volume from candles_15m where token = 1 order by bucket`,
    );
    expect(quarters.map((row) => row.bucket.toISOString())).toEqual([
      '2026-10-23T03:45:00.000Z',
      '2026-10-23T04:00:00.000Z',
      '2026-10-23T04:15:00.000Z',
      '2026-10-23T04:30:00.000Z',
      '2026-10-23T04:45:00.000Z',
      '2026-10-23T05:00:00.000Z',
    ]);
    // Open of the first minute in the bar, volume of all fifteen.
    expect(quarters[0]).toMatchObject({ open: '10001', volume: '150' });
    expect(quarters[1]).toMatchObject({ open: '10016', volume: '150' });

    const { rows: hours } = await app.query<{ bucket: Date; close: string }>(
      `select bucket, close from candles_1h where token = 1 order by bucket`,
    );
    expect(hours.map((row) => row.bucket.toISOString())).toEqual([
      '2026-10-23T03:45:00.000Z',
      '2026-10-23T04:45:00.000Z',
    ]);
    expect(hours[0]?.close).toBe(String(10050 + 60));
  });

  it('puts a whole IST session in one daily bar, materialised or not', async () => {
    await insertMinutes('2026-10-23T03:45:00Z', '2026-10-23T09:59:00Z');
    const read = () =>
      app.query<{ bucket: Date; high: string; low: string; volume: string }>(
        `select bucket, high, low, volume from candles_1d where token = 1`,
      );
    const live = await read();
    await owner.query(`CALL refresh_continuous_aggregate('candles_1d', NULL, NULL)`);
    const materialised = await read();
    for (const { rows } of [live, materialised]) {
      expect(rows).toEqual([
        {
          bucket: new Date('2026-10-23T03:45:00Z'),
          high: String(10100 + 375),
          low: String(9900 + 1),
          volume: String(375 * 10),
        },
      ]);
    }
  });

  it('keeps the app role to rows: it cannot create, alter or drop, nor delete bars', async () => {
    await insertMinutes('2026-10-23T03:45:00Z', '2026-10-23T03:46:00Z');
    await expect(app.query('CREATE TABLE candles_x (id int)')).rejects.toThrow(/permission denied/);
    await expect(app.query('DROP TABLE candles_1m')).rejects.toThrow(/must be owner/);
    await expect(app.query('ALTER TABLE candles_1m ADD COLUMN x int')).rejects.toThrow(
      /must be owner/,
    );
    await expect(app.query('DROP MATERIALIZED VIEW candles_5m')).rejects.toThrow(/must be owner/);
    await expect(app.query('DELETE FROM candles_1m')).rejects.toThrow(/permission denied/);
    await expect(app.query('DROP EXTENSION timescaledb')).rejects.toThrow(/must be owner/);
    await expect(app.query('INSERT INTO candles_5m VALUES (1)')).rejects.toThrow();
  });

  it('rejects a bar whose high and low do not bound its open and close', async () => {
    await expect(
      app.query(`INSERT INTO candles_1m VALUES (1, '2026-10-23T03:45:00Z', 100, 90, 80, 95, 0)`),
    ).rejects.toThrow(/candles_1m_prices_check/);
  });
});
