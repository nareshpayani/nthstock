import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, MIGRATIONS_TABLE, runMigrations } from '../db/migrate.js';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from './testPostgres.js';

async function query<T extends object>(url: string, text: string): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: unknown[];
};

describeWithPostgres('test Postgres helper and migrations (integration)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
    await query(pg.ownerUrl, 'CREATE TABLE IF NOT EXISTS helper_probe (id bigserial, note text)');
  }, 180_000);

  afterAll(async () => {
    await query(pg.ownerUrl, 'DROP TABLE IF EXISTS helper_probe');
  });

  it('creates one database per worker and reuses it', async () => {
    expect(pg.database).toMatch(/^nthstock_test_api_\w+$/);
    expect(await useTestPostgres()).toBe(pg);
    const [row] = await query<{ db: string; who: string }>(
      pg.appUrl,
      'select current_database() as db, current_user as who',
    );
    expect(row).toEqual({ db: pg.database, who: 'nthstock_app' });
  });

  it('applies every migration once; a second run changes nothing (T-179)', async () => {
    const countApplied = async () =>
      (await query<{ n: string }>(pg.ownerUrl, `select count(*) as n from ${MIGRATIONS_TABLE}`))[0]
        ?.n;

    expect(Number(await countApplied())).toBe(journal.entries.length);
    await runMigrations(pg.ownerUrl);
    expect(Number(await countApplied())).toBe(journal.entries.length);
  });

  it('refuses DDL and temp tables to the app role (T-177)', async () => {
    await expect(query(pg.appUrl, 'CREATE TABLE app_made (id int)')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(query(pg.appUrl, 'CREATE TEMP TABLE app_temp (id int)')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(query(pg.purgeUrl, 'CREATE TABLE purge_made (id int)')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it("gives the app role DML on the owner's new tables by default (T-179)", async () => {
    await query(pg.appUrl, "INSERT INTO helper_probe (note) VALUES ('a'), ('b')");
    await query(pg.appUrl, "UPDATE helper_probe SET note = 'c' WHERE note = 'b'");
    await query(pg.appUrl, "DELETE FROM helper_probe WHERE note = 'a'");

    expect(await query(pg.appUrl, 'SELECT note FROM helper_probe')).toEqual([{ note: 'c' }]);
    await expect(query(pg.appUrl, 'TRUNCATE helper_probe')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('truncates every table as the owner and restarts identities', async () => {
    await query(pg.appUrl, "INSERT INTO helper_probe (note) VALUES ('x')");

    await pg.truncate();

    expect(await query(pg.appUrl, 'SELECT * FROM helper_probe')).toEqual([]);
    const [row] = await query<{ id: string }>(
      pg.appUrl,
      "INSERT INTO helper_probe (note) VALUES ('y') RETURNING id",
    );
    expect(row?.id).toBe('1');
  });
});
