import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from '../test/testPostgres.js';

// The paper account tables as the migrations build them (T-200, spec backend-core §4.3).

const MONEY_COLUMNS: Record<string, string[]> = {
  paper_accounts: ['opening_balance', 'version'],
  ledger_entries: ['seq', 'amount', 'balance_after'],
  positions: ['open_cost', 'buy_value', 'sell_value', 'realised_pnl'],
  holdings: ['invested_value'],
  holding_sales: ['proceeds', 'realised_pnl'],
  pnl_snapshots: ['invested', 'current_value', 'day_pnl', 'realised_pnl', 'total_pnl'],
};

describeWithPostgres('paper account tables (integration)', () => {
  let pg: TestPostgres;
  let owner: Client;
  let app: Client;
  let purge: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    owner = new Client({ connectionString: pg.ownerUrl });
    app = new Client({ connectionString: pg.appUrl });
    purge = new Client({ connectionString: pg.purgeUrl });
    await Promise.all([owner.connect(), app.connect(), purge.connect()]);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([owner.end(), app.end(), purge.end()]);
  });

  beforeEach(async () => {
    await pg.truncate();
    await owner.query(
      `INSERT INTO users (id, created_at, updated_at, purged_at)
       VALUES ('usr_a', now(), now(), now())`,
    );
  });

  it('stores every money column as bigint', async () => {
    const { rows } = await app.query<{ table: string; column: string; type: string }>(
      `select table_name as "table", column_name as "column", data_type as type
         from information_schema.columns
        where table_schema = 'public' and table_name = any($1)`,
      [Object.keys(MONEY_COLUMNS)],
    );
    for (const [table, columns] of Object.entries(MONEY_COLUMNS)) {
      for (const column of columns) {
        const found = rows.find((row) => row.table === table && row.column === column);
        expect(found?.type, `${table}.${column}`).toBe('bigint');
      }
    }
    expect(rows.filter((row) => row.type === 'double precision' || row.type === 'numeric')).toEqual(
      [],
    );
  });

  describe('ledger_entries is append-only for the app role', () => {
    const insert = (client: Client, seq: number) =>
      client.query(
        `INSERT INTO ledger_entries (id, user_id, seq, type, amount, balance_after, description, created_at)
         VALUES ($1, 'usr_a', $2, 'OPENING_CREDIT', 100000000, 100000000, 'Opening', now())`,
        [`led_${String(seq)}`, seq],
      );

    const count = async () =>
      Number(
        (await owner.query<{ n: string }>('select count(*) as n from ledger_entries')).rows[0]?.n,
      );

    it('lets the app role INSERT and SELECT, with a unique per-user seq', async () => {
      await insert(app, 1);
      await insert(app, 2);

      await expect(
        app.query(
          `INSERT INTO ledger_entries (id, user_id, seq, type, amount, balance_after, description, created_at)
           VALUES ('led_dup', 'usr_a', 2, 'RESET', 0, 0, 'dup', now())`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
      expect(await count()).toBe(2);
    });

    it('refuses UPDATE and DELETE to the app role', async () => {
      await insert(app, 1);

      await expect(app.query('UPDATE ledger_entries SET amount = 1')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(app.query('DELETE FROM ledger_entries')).rejects.toMatchObject({
        code: '42501',
      });
      expect(await count()).toBe(1);
    });

    it('lets the purge role DELETE but not UPDATE', async () => {
      await insert(app, 1);

      await expect(purge.query('UPDATE ledger_entries SET amount = 1')).rejects.toMatchObject({
        code: '42501',
      });
      await purge.query('DELETE FROM ledger_entries');
      expect(await count()).toBe(0);
    });
  });
});
