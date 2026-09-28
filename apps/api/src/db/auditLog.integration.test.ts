import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../modules/audit/schema.js';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from '../test/testPostgres.js';

// The audit_log table as the migrations build it (T-185, spec backend-core §4.4) and its
// append-only enforcement (T-186, §8).

describeWithPostgres('audit_log table (integration)', () => {
  let pg: TestPostgres;
  let app: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    app = new Client({ connectionString: pg.appUrl });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app.end();
  });

  beforeEach(async () => {
    await pg.truncate();
  });

  const insert = (columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    return app.query<{ id: string; at: Date; detail: unknown }>(
      `INSERT INTO audit_log (${names.join(', ')})
       VALUES (${names.map((_, i) => `$${String(i + 1)}`).join(', ')})
       RETURNING id, at, detail`,
      Object.values(columns),
    );
  };

  const systemEntry = { actor_type: 'system', action: 'ORDER_UPDATE', outcome: 'OK' };

  it('has the spec columns, the two indexes and no foreign keys', async () => {
    const { rows: columns } = await app.query<{ name: string; type: string; nullable: string }>(
      `select column_name as name, data_type as type, is_nullable as nullable
         from information_schema.columns where table_name = 'audit_log' order by ordinal_position`,
    );
    expect(columns).toEqual([
      { name: 'id', type: 'bigint', nullable: 'NO' },
      { name: 'at', type: 'timestamp with time zone', nullable: 'NO' },
      { name: 'actor_type', type: 'text', nullable: 'NO' },
      { name: 'actor_user_id', type: 'text', nullable: 'YES' },
      { name: 'user_id', type: 'text', nullable: 'YES' },
      { name: 'action', type: 'text', nullable: 'NO' },
      { name: 'order_id', type: 'text', nullable: 'YES' },
      { name: 'outcome', type: 'text', nullable: 'NO' },
      { name: 'request_id', type: 'text', nullable: 'YES' },
      { name: 'detail', type: 'jsonb', nullable: 'NO' },
    ]);

    const { rows: indexes } = await app.query<{ def: string }>(
      `select indexdef as def from pg_indexes where tablename = 'audit_log' order by indexname`,
    );
    expect(indexes.map((row) => row.def.replace(/^.* USING /, ''))).toEqual([
      'btree (action, at)',
      'btree (id)',
      'btree (user_id, at)',
    ]);

    const { rows: foreignKeys } = await app.query(
      `select conname from pg_constraint
        where contype = 'f' and (conrelid = 'audit_log'::regclass or confrelid = 'audit_log'::regclass)`,
    );
    expect(foreignKeys).toEqual([]);
  });

  it('defaults at to now() and detail to {}, and takes a NULL user_id', async () => {
    const before = Date.now();
    const { rows } = await insert(systemEntry);

    expect(rows[0]?.id).toBe('1');
    expect(rows[0]?.detail).toEqual({});
    expect(rows[0]?.at.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });

  it('accepts every action the code knows and rejects any other', async () => {
    for (const action of AUDIT_ACTIONS) await insert({ ...systemEntry, action });

    await expect(insert({ ...systemEntry, action: 'ORDER_DELETE' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'audit_log_action_check',
    });
  });

  it('checks the outcome, the actor and the detail shape', async () => {
    await expect(insert({ ...systemEntry, outcome: 'MAYBE' })).rejects.toMatchObject({
      constraint: 'audit_log_outcome_check',
    });
    await expect(insert({ ...systemEntry, actor_type: 'user' })).rejects.toMatchObject({
      constraint: 'audit_log_actor_check',
    });
    await expect(insert({ ...systemEntry, actor_user_id: 'usr_a' })).rejects.toMatchObject({
      constraint: 'audit_log_actor_check',
    });
    await expect(insert({ ...systemEntry, actor_type: 'robot' })).rejects.toMatchObject({
      constraint: 'audit_log_actor_check',
    });
    await expect(insert({ ...systemEntry, detail: '[1]' })).rejects.toMatchObject({
      constraint: 'audit_log_detail_check',
    });
    await insert({ ...systemEntry, actor_type: 'user', actor_user_id: 'usr_a', user_id: 'usr_a' });
  });

  describe('append-only (T-186)', () => {
    let owner: Client;
    let purge: Client;

    beforeAll(async () => {
      owner = new Client({ connectionString: pg.ownerUrl });
      purge = new Client({ connectionString: pg.purgeUrl });
      await Promise.all([owner.connect(), purge.connect()]);
    });

    afterAll(async () => {
      await Promise.all([owner.end(), purge.end()]);
    });

    const count = async () =>
      Number((await app.query<{ n: string }>('select count(*) as n from audit_log')).rows[0]?.n);

    it('lets the app role INSERT and SELECT', async () => {
      await insert(systemEntry);
      await insert({ ...systemEntry, user_id: 'usr_a' });

      expect(await count()).toBe(2);
    });

    it('refuses UPDATE, DELETE and TRUNCATE to the app role', async () => {
      await insert(systemEntry);

      for (const statement of [
        "UPDATE audit_log SET outcome = 'REFUSED'",
        'DELETE FROM audit_log',
        'TRUNCATE audit_log',
      ]) {
        await expect(app.query(statement)).rejects.toMatchObject({ code: '42501' });
      }
      expect(await count()).toBe(1);
    });

    it('refuses UPDATE and DELETE to the purge role, which may still insert', async () => {
      await purge.query(
        `INSERT INTO audit_log (actor_type, action, outcome) VALUES ('system', 'ORDER_UPDATE', 'OK')`,
      );

      await expect(purge.query('DELETE FROM audit_log')).rejects.toMatchObject({ code: '42501' });
      await expect(purge.query("UPDATE audit_log SET user_id = 'x'")).rejects.toMatchObject({
        code: '42501',
      });
      expect(await count()).toBe(1);
    });

    it('rejects UPDATE and DELETE for the owner too, through the trigger', async () => {
      await insert({ ...systemEntry, user_id: 'usr_a' });

      await expect(owner.query("UPDATE audit_log SET outcome = 'REFUSED'")).rejects.toMatchObject({
        code: '23001',
        message: 'audit_log is append-only: UPDATE is not allowed',
      });
      await expect(
        owner.query("DELETE FROM audit_log WHERE user_id = 'usr_a'"),
      ).rejects.toMatchObject({
        code: '23001',
        message: 'audit_log is append-only: DELETE is not allowed',
      });
      const { rows } = await app.query<{ outcome: string }>('select outcome from audit_log');
      expect(rows).toEqual([{ outcome: 'OK' }]);
    });

    it('still lets the owner TRUNCATE (how tests reset it)', async () => {
      await insert(systemEntry);

      await owner.query('TRUNCATE audit_log');

      expect(await count()).toBe(0);
    });
  });
});
