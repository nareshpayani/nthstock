import { routes } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createDatabase, type Database } from '../../db/client.js';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { PURGED_TABLES, runAccountPurge } from './accountPurge.js';

// The account purge on Postgres as nthstock_purge (T-230, spec backend-core §10): after it, no
// table but audit_log holds a row naming the user, and the users row is a tombstone without PII.

const master = generateSymbolMaster({ equityCount: 20 });
const EQUITY = master.equities[0]?.instrument;
const TOKEN = EQUITY?.token ?? 0;
const SYMBOL = EQUITY?.symbol ?? '';
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };
const MOBILE = '9876543210';
const OTHER_MOBILE = '9876500001';
const DAY_MS = 24 * 60 * 60 * 1000;

describeWithPostgres('account purge on Postgres (integration, T-230)', () => {
  let pg: TestPostgres;
  let owner: Client;
  let database: Database | undefined;
  let purgeDatabase: Database | undefined;
  let app: App | undefined;
  let market: MockMarketDataAdapter | undefined;

  beforeAll(async () => {
    pg = await useTestPostgres();
    owner = new Client({ connectionString: pg.ownerUrl });
    await owner.connect();
  }, 180_000);

  afterAll(async () => {
    await owner.end();
  });

  beforeEach(async () => {
    await pg.truncate();
  });

  afterEach(async () => {
    await app?.close();
    market?.dispose();
    await Promise.all([database?.close(), purgeDatabase?.close()]);
    app = undefined;
    market = undefined;
    database = undefined;
    purgeDatabase = undefined;
  });

  const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open

  function start(): App {
    market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
    database = createDatabase({ url: pg.appUrl, poolMax: 4 });
    app = buildApp({
      deps: { clock, market, database, onAuditError: () => undefined },
      orderSweepMs: null,
    });
    return app;
  }

  /** Signs `mobile` up and gives it a row in as many user tables as the API can reach. */
  async function activeUser(server: App, mobile: string): Promise<string> {
    const user = await loginWithOtp(server, mobile);
    const headers = { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' };
    const call = async (method: 'POST', url: string, payload: object) => {
      const response = await server.inject({ method, url, headers, payload });
      expect(response.statusCode, `${url}: ${response.body}`).toBeLessThan(300);
      return response.json<{ id?: string }>();
    };
    await call('POST', routes.pinSet.path, { pin: '4826', confirmPin: '4826' });
    const list = await call('POST', routes.watchlistCreate.path, { name: 'Purge test' });
    await call('POST', routes.watchlistItemAdd.path.replace(':id', list.id ?? ''), {
      token: TOKEN,
    });
    const quote = await market?.getQuote(SYMBOL);
    if (!quote) throw new Error('no quote');
    const order = { token: TOKEN, side: 'BUY', product: 'DELIVERY', qty: 2 };
    await call('POST', routes.orderPlace.path, { ...order, type: 'MARKET' });
    await call('POST', routes.orderPlace.path, {
      ...order,
      type: 'LIMIT',
      price: quote.ltp - 1_000,
    });
    await call('POST', routes.priceAlertCreate.path, {
      symbol: SYMBOL,
      condition: 'ABOVE',
      price: quote.ltp + 10_000,
    });
    return user.session.user.id;
  }

  /** Every ordinary and partitioned table in `public`, without the partitions themselves. */
  const tables = async () =>
    (
      await owner.query<{ name: string }>(
        `select c.relname as name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
          order by 1`,
      )
    ).rows.map((row) => row.name);

  /** How many rows of `table` mention `id` anywhere in the row. */
  const rowsNaming = async (table: string, id: string) =>
    Number(
      (
        await owner.query<{ count: string }>(
          `select count(*) as count from "${table}" t where strpos(row_to_json(t)::text, $1) > 0`,
          [id],
        )
      ).rows[0]?.count ?? 0,
    );

  it('every table with a user_id or a foreign key to users is purged, except audit_log', async () => {
    const { rows } = await owner.query<{ name: string }>(
      `select distinct c.table_name as name
         from information_schema.columns c
         join pg_class r on r.relname = c.table_name and not r.relispartition
        where c.table_schema = 'public' and c.column_name = 'user_id'
       union
       select distinct conrelid::regclass::text
         from pg_constraint
        where contype = 'f' and confrelid = 'users'::regclass`,
    );
    const userTables = rows.map((row) => row.name).filter((name) => name !== 'audit_log');
    expect([...new Set(userTables)].sort()).toEqual([...PURGED_TABLES].sort());
  });

  it('leaves only audit rows and a tombstone without PII, and the mobile can sign up again', async () => {
    const server = start();
    const userId = await activeUser(server, MOBILE);
    const otherId = await activeUser(server, OTHER_MOBILE);
    const users = createPgUsersRepo({
      database: database as Database,
      clock,
      pii: createPiiCrypto(devPiiKeys()),
    });
    // Deleted 31 days ago, so its purge date has passed; the other user is not deleted.
    const at = new Date(clock.now().getTime() + 31 * DAY_MS);
    expect(await users.markDeleted(userId, clock.now(), new Date(at.getTime() - DAY_MS))).toBe(
      true,
    );
    const before: Record<string, number> = {};
    for (const table of await tables()) before[table] = await rowsNaming(table, userId);
    // The API reached most user tables; the purge must clear them all.
    expect(Object.values(before).filter((count) => count > 0).length).toBeGreaterThan(8);

    purgeDatabase = createDatabase({ url: pg.purgeUrl, poolMax: 1 });
    expect(await runAccountPurge(at, { purgeDatabase })).toEqual({ accounts: 1 });
    expect(await runAccountPurge(at, { purgeDatabase })).toEqual({ accounts: 0 });

    for (const table of await tables()) {
      if (table === 'audit_log' || table === 'users') continue;
      expect(await rowsNaming(table, userId), table).toBe(0);
    }
    expect(await rowsNaming('audit_log', userId)).toBeGreaterThan(0);
    const purged = await owner.query<{ action: string; actor_type: string }>(
      `select action, actor_type from audit_log where user_id = $1 and action = 'ACCOUNT_PURGED'`,
      [userId],
    );
    expect(purged.rows).toEqual([{ action: 'ACCOUNT_PURGED', actor_type: 'system' }]);

    const tombstone = await owner.query<Record<string, unknown>>(
      'select * from users where id = $1',
      [userId],
    );
    expect(tombstone.rows).toHaveLength(1);
    expect(tombstone.rows[0]).toMatchObject({
      mobile_enc: null,
      mobile_hash: null,
      mobile_last4: null,
      name_enc: null,
      email_enc: null,
      pin_set: false,
      totp_enabled: false,
      kyc_status: 'NOT_STARTED',
      purged_at: at,
    });

    // The other user keeps everything.
    for (const table of ['orders', 'ledger_entries', 'watchlists', 'sessions', 'price_alerts']) {
      expect(await rowsNaming(table, otherId), table).toBeGreaterThan(0);
    }

    // The mobile now signs up as somebody new.
    const again = await loginWithOtp(server, MOBILE);
    expect(again.session.user.id).not.toBe(userId);
  });

  it('one failing account rolls back alone: the run purges the rest, then throws', async () => {
    const server = start();
    const failing = (await loginWithOtp(server, '9876500011')).session.user.id;
    const due = (await loginWithOtp(server, '9876500012')).session.user.id;
    const notDue = (await loginWithOtp(server, '9876500013')).session.user.id;
    const users = createPgUsersRepo({
      database: database as Database,
      clock,
      pii: createPiiCrypto(devPiiKeys()),
    });
    const at = new Date(clock.now().getTime() + 31 * DAY_MS);
    // The failing account is first in purge order; the last one is not due until tomorrow.
    await users.markDeleted(failing, clock.now(), new Date(at.getTime() - 2 * DAY_MS));
    await users.markDeleted(due, clock.now(), new Date(at.getTime() - DAY_MS));
    await users.markDeleted(notDue, clock.now(), new Date(at.getTime() + DAY_MS));
    await owner.query(
      `create function purge_test_refuse() returns trigger language plpgsql as $$
         begin
           if old.user_id = '${failing}' then raise exception 'refused for the test'; end if;
           return old;
         end $$`,
    );
    await owner.query(
      'create trigger purge_test_refuse before delete on consents for each row execute function purge_test_refuse()',
    );
    purgeDatabase = createDatabase({ url: pg.purgeUrl, poolMax: 1 });
    try {
      // A batch of one walks the keyset past the failed account.
      await expect(runAccountPurge(at, { purgeDatabase }, 1)).rejects.toThrow(
        /failed for 1 account\(s\); 1 purged/,
      );
    } finally {
      await owner.query('drop trigger purge_test_refuse on consents');
      await owner.query('drop function purge_test_refuse()');
    }

    const state = async (id: string) =>
      (
        await owner.query<{ purged: boolean; mobile: boolean; consents: string }>(
          `select purged_at is not null as purged, mobile_hash is not null as mobile,
                  (select count(*) from consents where user_id = $1) as consents
             from users where id = $1`,
          [id],
        )
      ).rows[0];
    expect(await state(failing)).toEqual({ purged: false, mobile: true, consents: '1' });
    expect(await state(due)).toEqual({ purged: true, mobile: false, consents: '0' });
    expect(await state(notDue)).toEqual({ purged: false, mobile: true, consents: '1' });

    // The retry purges the account that failed, and still not the one that is not due.
    expect(await runAccountPurge(at, { purgeDatabase }, 1)).toEqual({ accounts: 1 });
    expect(await state(failing)).toMatchObject({ purged: true, mobile: false });
    expect(await state(notDue)).toMatchObject({ purged: false });
  });
});
