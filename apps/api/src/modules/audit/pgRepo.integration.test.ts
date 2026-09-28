import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../db/client.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createPgAuditRepo } from './pgRepo.js';
import type { NewAuditRecord } from './schema.js';

// What only the Postgres log can do (T-187): write in the caller's transaction.

const entry: NewAuditRecord = {
  actor: { type: 'system' },
  userId: 'usr_a',
  action: 'FUNDS_MOVEMENT',
  orderId: null,
  outcome: 'OK',
  detail: { type: 'RESET', amount: 100 },
};

describeWithPostgres('Postgres audit repo transactions (integration)', () => {
  let pg: TestPostgres;
  let database: Database;

  beforeAll(async () => {
    pg = await useTestPostgres();
    database = createDatabase({ url: pg.appUrl, poolMax: 2 });
  }, 180_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await pg.truncate();
  });

  const repo = () => createPgAuditRepo({ database, clock: manualClock() });

  it('commits entries written in the caller transaction with it', async () => {
    const written = await database.transaction((tx) => repo().appendMany([entry, entry], tx));

    expect(await repo().list('usr_a')).toEqual(written);
  });

  it('rolls them back with the caller transaction', async () => {
    await expect(
      database.transaction(async (tx) => {
        await repo().appendMany([entry], tx);
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');

    expect(await repo().list()).toEqual([]);
  });

  it('writes nothing of a batch the database refuses', async () => {
    const bad = { ...entry, action: 'NOT_AN_ACTION' } as unknown as NewAuditRecord;

    await expect(repo().appendMany([entry, bad])).rejects.toMatchObject({
      cause: { constraint: 'audit_log_action_check' },
    });
    expect(await repo().list()).toEqual([]);
  });
});
