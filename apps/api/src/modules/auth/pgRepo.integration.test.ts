import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../db/client.js';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { ApiHttpError } from '../../http/apiError.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createMemoryAuditRepo } from '../audit/repo.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { createPgAuthRepo } from './pgRepo.js';
import type { PinHasher } from './pinHasher.js';
import { createPinService } from './pinService.js';
import { createMemoryOtpStore } from './repo.js';
import { createSessionService } from './sessionService.js';

// The auth services on the Postgres stores under concurrency (T-191 onwards).

/** A fast stand-in for Argon2id: the lock logic is what is under test, not the hash. */
const plainHasher: PinHasher = {
  hash: (pin) => Promise.resolve(`plain:${pin}`),
  verify: (hash, pin) => Promise.resolve(hash === `plain:${pin}`),
};

describeWithPostgres('auth services on Postgres (integration)', () => {
  let pg: TestPostgres;
  let database: Database;

  beforeAll(async () => {
    pg = await useTestPostgres();
    database = createDatabase({ url: pg.appUrl, poolMax: 8 });
  }, 180_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await pg.truncate();
  });

  function services() {
    const clock = manualClock();
    const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
    const repo = createPgAuthRepo({ database, clock, otp: createMemoryOtpStore() });
    const audit = createMemoryAuditRepo({ clock });
    const sessions = createSessionService({
      clock,
      repo,
      users,
      audit,
      secret: new Uint8Array(32).fill(1),
    });
    const pins = createPinService({ clock, repo, users, sessions, hasher: plainHasher, audit });
    return { clock, users, repo, audit, sessions, pins };
  }

  it('counts 5 concurrent wrong PINs to exactly 5: four PIN_INVALID, one PIN_LOCKED (T-191)', async () => {
    const { users, repo, audit, sessions, pins } = services();
    const user = await users.create({ mobile: '9876543210' });
    const issued = await sessions.start({ user, method: 'OTP', userAgent: undefined });
    const context = await sessions.authenticate(issued.access.token, 'cookie');
    if (!context) throw new Error('the new session did not authenticate');
    const trusted = await pins.set(context, '482105');

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        pins.verify({ deviceToken: trusted.token, pin: '000000', userAgent: undefined }),
      ),
    );

    const codes = results.map((result) =>
      result.status === 'rejected' && result.reason instanceof ApiHttpError
        ? result.reason.code
        : 'unexpected',
    );
    expect(codes.toSorted()).toEqual([
      'PIN_INVALID',
      'PIN_INVALID',
      'PIN_INVALID',
      'PIN_INVALID',
      'PIN_LOCKED',
    ]);
    expect((await repo.getPin(user.id))?.failures).toBe(5);
    const actions = (await audit.list(user.id)).map((entry) => entry.action);
    expect(actions.filter((action) => action === 'PIN_LOCKED')).toHaveLength(1);
    expect(actions.filter((action) => action === 'LOGIN_FAILED')).toHaveLength(4);

    // Locked: even the right PIN is refused until an OTP unlocks it.
    await expect(
      pins.verify({ deviceToken: trusted.token, pin: '482105', userAgent: undefined }),
    ).rejects.toMatchObject({ code: 'PIN_LOCKED' });
    await pins.unlock(user.id);
    const session = await pins.verify({
      deviceToken: trusted.token,
      pin: '482105',
      userAgent: undefined,
    });
    expect(session.device).toMatchObject({ id: issued.device.id, trusted: true });
  });
});
