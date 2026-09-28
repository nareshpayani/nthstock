import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

// Smoke test against a running Postgres (`npm run infra:up`, or any server) at POSTGRES_TEST_URL.
const url = process.env.POSTGRES_TEST_URL;

describe.skipIf(!url)('Postgres client (integration)', () => {
  const database = createDatabase({ url: url ?? '', poolMax: 2 });

  afterAll(async () => {
    await database.close();
  });

  it('runs a smoke query', async () => {
    await database.ping();
    const result = await database.db.execute<{ answer: number }>(sql`select 41 + 1 as answer`);

    expect(result.rows).toEqual([{ answer: 42 }]);
  });

  it('sets statement_timeout for the transaction only', async () => {
    const inside = await database.transaction(
      (tx) => tx.execute<{ statement_timeout: string }>(sql`show statement_timeout`),
      { statementTimeoutMs: 1_500 },
    );
    const outside = await database.db.execute<{ statement_timeout: string }>(
      sql`show statement_timeout`,
    );

    expect(inside.rows[0]?.statement_timeout).toBe('1500ms');
    expect(outside.rows[0]?.statement_timeout).toBe('0');
  });

  it('cancels a statement that runs past the timeout', async () => {
    await expect(
      database.transaction((tx) => tx.execute(sql`select pg_sleep(2)`), {
        statementTimeoutMs: 50,
      }),
    ).rejects.toMatchObject({ cause: { code: '57014' } });
  });
});
