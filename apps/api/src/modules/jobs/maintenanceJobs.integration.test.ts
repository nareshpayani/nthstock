import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../db/client.js';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createPgAuthRepo } from '../auth/pgRepo.js';
import { createMemoryOtpStore } from '../auth/repo.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { runOrderPartitions, runTokenCleanup } from './maintenanceJobs.js';

// The maintenance jobs on Postgres as the app role (T-210, spec backend-core §9).

const DAY_MS = 24 * 60 * 60 * 1000;
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

describeWithPostgres('maintenance jobs on Postgres (integration)', () => {
  let pg: TestPostgres;
  let database: Database;
  let owner: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    database = createDatabase({ url: pg.appUrl, poolMax: 2 });
    owner = new Client({ connectionString: pg.ownerUrl });
    await owner.connect();
  }, 180_000);

  afterAll(async () => {
    await Promise.all([database.close(), owner.end()]);
  });

  beforeEach(async () => {
    await pg.truncate();
  });

  /** The daily partitions of `parent` (truncate leaves tables, so earlier tests' may remain). */
  const dailyPartitions = async (parent: string) =>
    (
      await owner.query<{ name: string }>(
        `select c.relname as name
           from pg_inherits i
           join pg_class c on c.oid = i.inhrelid
          where i.inhparent = $1::regclass and c.relname <> $2
          order by c.relname`,
        [parent, `${parent}_default`],
      )
    ).rows.map((row) => row.name);

  const auth = () =>
    createPgAuthRepo({
      database,
      clock: manualClock(),
      pii: createPiiCrypto(devPiiKeys()),
      otp: createMemoryOtpStore(),
    });

  it('db.orderPartitions: partitions exist for the next 14 IST days, and a rerun adds none', async () => {
    // 00:30 IST on 2027-03-01 is still 2027-02-28 in UTC.
    const at = new Date('2027-02-28T19:00:00.000Z');
    const deps = { database, auth: auth() };

    expect(await runOrderPartitions(at, deps)).toEqual({ partitions: 14 });

    const expected = Array.from({ length: 14 }, (_, i) =>
      new Date(Date.UTC(2027, 2, 1) + i * DAY_MS).toISOString().slice(0, 10).replaceAll('-', ''),
    );
    const orders = (await dailyPartitions('orders')).filter((name) => name >= 'orders_20270228');
    expect(orders).toEqual(expected.map((day) => `orders_${day}`));
    const events = (await dailyPartitions('order_events')).filter(
      (name) => name >= 'order_events_20270228',
    );
    expect(events).toEqual(expected.map((day) => `order_events_${day}`));

    expect(await runOrderPartitions(at, deps)).toEqual({ partitions: 0 });
    // The next night adds only the one new day at the end.
    expect(await runOrderPartitions(new Date(at.getTime() + DAY_MS), deps)).toEqual({
      partitions: 1,
    });
    expect(await dailyPartitions('orders')).toContain('orders_20270315');
  });

  it('auth.tokenCleanup: expired rows are gone, live ones remain', async () => {
    const now = new Date('2026-12-01T21:30:00.000Z'); // 03:00 IST
    const days = (n: number) => new Date(now.getTime() + n * DAY_MS);
    const users = createPgUsersRepo({
      database,
      clock: manualClock(),
      pii: createPiiCrypto(devPiiKeys()),
    });
    await users.ensureSeeded({ ...DEMO_USER, id: 'usr_a', mobile: '9000000100' });
    const repo = auth();
    const device = (id: string) => ({
      id,
      userId: 'usr_a',
      label: 'Chrome on macOS',
      trusted: true,
      createdAt: days(-60),
      lastSeenAt: days(-60),
    });
    const session = (id: string, expiresAt: Date) => ({
      id,
      userId: 'usr_a',
      deviceId: 'dev_1',
      csrfToken: `csrf-${id}`,
      createdAt: days(-60),
      lastSeenAt: days(-60),
      expiresAt,
      steppedUpAt: null,
      revokedAt: null,
      revokedReason: null,
    });
    const refresh = (sessionId: string, expiresAt: Date) => ({
      sessionId,
      expiresAt,
      usedAt: null,
    });
    await repo.createDevice(device('dev_1'));
    await repo.createDevice(device('dev_2'));
    await repo.putDeviceToken(hashOf('t_old'), { deviceId: 'dev_1', expiresAt: days(-1) });
    await repo.putDeviceToken(hashOf('t_live'), { deviceId: 'dev_2', expiresAt: days(1) });
    await repo.createSession(session('ses_live', days(1)));
    await repo.createSession(session('ses_recent', days(-29)));
    await repo.createSession(session('ses_old', days(-31)));
    await repo.putRefreshToken(hashOf('r_live'), refresh('ses_live', days(1)));
    await repo.putRefreshToken(hashOf('r_used'), refresh('ses_live', days(-2)));
    await repo.putRefreshToken(hashOf('r_old'), refresh('ses_old', days(-31)));
    await repo.putRefreshToken(hashOf('r_family'), refresh('ses_old', days(1)));

    expect(await runTokenCleanup(now, { database, auth: repo })).toEqual({
      refreshTokens: 2,
      deviceTokens: 1,
      sessions: 1,
    });

    const count = async (table: string) =>
      Number((await owner.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);
    expect(await count('device_tokens')).toBe(1);
    expect(await count('devices')).toBe(2);
    expect(await count('sessions')).toBe(2);
    expect(await count('refresh_tokens')).toBe(1);
    expect(await repo.getDeviceToken(hashOf('t_live'))).not.toBeNull();
    expect(await repo.getSession('ses_recent')).not.toBeNull();
    expect(await repo.useRefreshToken(hashOf('r_live'), now)).toMatchObject({
      sessionId: 'ses_live',
    });

    expect(await runTokenCleanup(now, { database, auth: repo })).toEqual({
      refreshTokens: 0,
      deviceTokens: 0,
      sessions: 0,
    });
  });
});
