import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createDatabase, type Database } from '../../db/client.js';
import { createPiiCrypto, devPiiKeys, mobileHash } from '../../db/crypto.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createPgUsersRepo } from './pgRepo.js';
import { DEMO_USER } from './repo.js';

// What only the Postgres users repo can show (T-190): the stored rows hold no plaintext PII, and
// the soft-delete and tombstone rules of the table.

const pii = createPiiCrypto(devPiiKeys());
const MOBILE = '9876543210';
const NAME = 'Asha Rao';
const EMAIL = 'asha.rao@example.com';

describeWithPostgres('Postgres users repo (integration, T-190)', () => {
  let pg: TestPostgres;
  let database: Database;
  let raw: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    database = createDatabase({ url: pg.appUrl, poolMax: 2 });
    raw = new Client({ connectionString: pg.appUrl });
    await raw.connect();
  }, 180_000);

  afterAll(async () => {
    await raw.end();
    await database.close();
  });

  beforeEach(async () => {
    await pg.truncate();
  });

  const repo = () => createPgUsersRepo({ database, clock: manualClock(), pii });

  it('stores no plaintext mobile, name or email (raw row read)', async () => {
    const created = await repo().create({ mobile: MOBILE, name: NAME, email: EMAIL });

    const { rows } = await raw.query<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [
      created.id,
    ]);
    const row = rows[0] ?? {};
    const { rows: text } = await raw.query<{ row: string }>(
      'SELECT row_to_json(u)::text AS row FROM users u WHERE id = $1',
      [created.id],
    );
    const dump = text[0]?.row ?? '';
    for (const secret of [MOBILE, NAME, EMAIL]) {
      expect(dump).not.toContain(secret);
      for (const value of Object.values(row)) {
        if (Buffer.isBuffer(value)) expect(value.includes(Buffer.from(secret))).toBe(false);
        else expect(String(value)).not.toContain(secret);
      }
    }
    expect(row['mobile_last4']).toBe('3210');
    expect(Buffer.isBuffer(row['mobile_enc'])).toBe(true);
    expect((row['mobile_hash'] as Buffer).equals(mobileHash(pii, MOBILE))).toBe(true);
    expect(pii.decrypt(row['name_enc'] as Buffer, 'users.name_enc')).toBe(NAME);
  });

  it('cannot read PII with the wrong keys', async () => {
    const created = await repo().create({ mobile: MOBILE });
    const otherKeys = createPiiCrypto({
      encryption: new Map([[1, Buffer.alloc(32, 3)]]),
      currentKeyId: 1,
      hmac: Buffer.alloc(32, 4),
    });
    const other = createPgUsersRepo({ database, clock: manualClock(), pii: otherKeys });

    await expect(other.findById(created.id)).rejects.toThrow(/failed authentication/);
    // A different blind-index key finds nothing.
    expect(await other.findByMobile(MOBILE)).toBeNull();
  });

  it('hides a deleted user from findByMobile and lets the mobile sign up again', async () => {
    const first = await repo().create({ mobile: MOBILE });
    await raw.query('UPDATE users SET deleted_at = now() WHERE id = $1', [first.id]);

    expect(await repo().findByMobile(MOBILE)).toBeNull();
    expect(await repo().findById(first.id)).toMatchObject({ id: first.id, mobile: MOBILE });

    const second = await repo().create({ mobile: MOBILE });
    expect(second.id).not.toBe(first.id);
    expect(await repo().findByMobile(MOBILE)).toEqual(second);
  });

  it('reads a purged tombstone as no user, and only a tombstone may lack PII', async () => {
    const created = await repo().create({ mobile: MOBILE, name: NAME });

    await expect(
      raw.query('UPDATE users SET mobile_enc = NULL WHERE id = $1', [created.id]),
    ).rejects.toMatchObject({ constraint: 'users_mobile_check' });

    await raw.query(
      `UPDATE users SET deleted_at = now(), purged_at = now(), mobile_enc = NULL,
         mobile_hash = NULL, mobile_last4 = NULL, name_enc = NULL, email_enc = NULL
       WHERE id = $1`,
      [created.id],
    );
    expect(await repo().findById(created.id)).toBeNull();
    expect(await repo().update(created.id, { pinSet: true })).toBeNull();
  });

  it('holds kyc_status to the contract values', async () => {
    const created = await repo().create({ mobile: MOBILE });

    await expect(
      raw.query(`UPDATE users SET kyc_status = 'DONE' WHERE id = $1`, [created.id]),
    ).rejects.toMatchObject({ constraint: 'users_kyc_status_check' });
  });

  it('deletes a user’s consents with the user and checks the purpose', async () => {
    const created = await repo().create({ mobile: MOBILE });
    await raw.query(
      `INSERT INTO consents (user_id, purpose, policy_version, granted_at)
       VALUES ($1, 'TERMS_AND_PRIVACY', '2026-09', now())`,
      [created.id],
    );
    await expect(
      raw.query(
        `INSERT INTO consents (user_id, purpose, policy_version, granted_at)
         VALUES ($1, 'MARKETING', '2026-09', now())`,
        [created.id],
      ),
    ).rejects.toMatchObject({ constraint: 'consents_purpose_check' });

    await raw.query('DELETE FROM users WHERE id = $1', [created.id]);

    const { rows } = await raw.query('SELECT * FROM consents');
    expect(rows).toEqual([]);
  });

  it('seeds the demo user with its fixed id, encrypted like any other', async () => {
    expect(await repo().ensureSeeded(DEMO_USER)).toBe(true);

    expect(await repo().findByMobile(DEMO_USER.mobile)).toEqual(DEMO_USER);
    const { rows } = await raw.query<{ row: string }>(
      'SELECT row_to_json(u)::text AS row FROM users u',
    );
    expect(rows[0]?.row).not.toContain(DEMO_USER.mobile);
    expect(rows[0]?.row).not.toContain(DEMO_USER.name);
  });

  it('is the users repo of apps/api on DB_DRIVER=postgres: an OTP login signs up in Postgres', async () => {
    const clock = manualClock();
    const app = buildApp({ deps: { database, clock }, orderSweepMs: null });
    try {
      const { session } = await loginWithOtp(app, MOBILE);

      const { rows } = await raw.query<{ id: string }>('SELECT id FROM users');
      expect(rows).toEqual([{ id: session.user.id }]);
      expect(session.user.mobileMasked).toBe('******3210');
      // The same mobile logs in to the same user (after the OTP resend throttle).
      clock.advance(31_000);
      expect((await loginWithOtp(app, MOBILE)).session.user.id).toBe(session.user.id);
    } finally {
      await app.close();
    }
  });
});
