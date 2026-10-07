import { User } from '@nthstock/contracts';
import { fixedClock } from '@nthstock/utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { createPgUsersRepo } from './pgRepo.js';
import { DEMO_USER, DuplicateMobileError, createMemoryUsersRepo } from './repo.js';
import { maskMobile, toUser } from './service.js';

// The users repo conformance suite (T-190): the memory repo and the Postgres repo behave the same.

const clock = fixedClock('2026-09-25T04:00:00.000Z');
let counter = 0;
const newId = () => `usr_${String(++counter)}`;
const pii = createPiiCrypto(devPiiKeys());

describeRepoConformance(
  'users repo',
  {
    memory: () => {
      counter = 0;
      return createMemoryUsersRepo({ clock, newId });
    },
    postgres: (database) => {
      counter = 0;
      return createPgUsersRepo({ database, clock, pii, newId });
    },
  },
  ({ driver, repo, database }) => {
    it('creates a user stamped by the injected clock and finds it by id and mobile', async () => {
      const created = await repo().create({ mobile: '9876543210' });

      expect(created).toEqual({
        id: 'usr_1',
        mobile: '9876543210',
        name: null,
        email: null,
        kycStatus: 'NOT_STARTED',
        pinSet: false,
        totpEnabled: false,
        createdAt: new Date('2026-09-25T04:00:00.000Z'),
      });
      expect(await repo().findById('usr_1')).toEqual(created);
      expect(await repo().findByMobile('9876543210')).toEqual(created);
    });

    it('keeps the name and email given at creation', async () => {
      const created = await repo().create({ mobile: '9123456789', name: 'Ravi', email: 'r@x.in' });

      expect(await repo().findByMobile('9123456789')).toEqual(created);
      expect(created).toMatchObject({ name: 'Ravi', email: 'r@x.in' });
    });

    it('answers null for an unknown id or mobile', async () => {
      expect(await repo().findById('usr_missing')).toBeNull();
      expect(await repo().findByMobile('9999999999')).toBeNull();
    });

    it('rejects a second user with the same mobile', async () => {
      await repo().create({ mobile: '9876543210' });

      await expect(repo().create({ mobile: '9876543210' })).rejects.toBeInstanceOf(
        DuplicateMobileError,
      );
      await expect(repo().create({ mobile: '9876543210' })).rejects.toThrow(/already exists/);
    });

    it('lets exactly one of 5 concurrent sign-ups for one mobile through', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => repo().create({ mobile: '9811111111' })),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected')
          expect(result.reason).toBeInstanceOf(DuplicateMobileError);
      }
    });

    it('updates a user and returns null for an unknown id', async () => {
      const created = await repo().create({ mobile: '9876543210' });

      const updated = await repo().update(created.id, {
        pinSet: true,
        name: 'Asha',
        email: 'asha@example.com',
        kycStatus: 'PENDING',
        totpEnabled: true,
      });

      expect(updated).toEqual({
        ...created,
        pinSet: true,
        name: 'Asha',
        email: 'asha@example.com',
        kycStatus: 'PENDING',
        totpEnabled: true,
      });
      expect(await repo().findById(created.id)).toEqual(updated);
      expect(await repo().update(created.id, { name: null })).toMatchObject({
        name: null,
        email: 'asha@example.com',
      });
      expect(await repo().update('usr_missing', { pinSet: true })).toBeNull();
    });

    it('hands out copies, so callers cannot change stored users', async () => {
      const created = await repo().create({ mobile: '9876543210', name: 'Asha' });
      created.name = 'Mallory';
      created.createdAt.setUTCFullYear(1999);

      expect(await repo().findById(created.id)).toMatchObject({
        name: 'Asha',
        createdAt: new Date('2026-09-25T04:00:00.000Z'),
      });
    });

    it('seeds a fixed user once, and never over a user with its id or mobile', async () => {
      const seeded = { ...DEMO_USER, id: 'usr_seeded', mobile: '9000000009' };

      expect(await repo().ensureSeeded(seeded)).toBe(true);
      expect(await repo().ensureSeeded({ ...seeded, name: 'Changed' })).toBe(false);
      expect(await repo().findById('usr_seeded')).toEqual(seeded);
      expect(await repo().findByMobile('9000000009')).toEqual(seeded);

      const taken = await repo().create({ mobile: '9000000010' });
      expect(await repo().ensureSeeded({ ...seeded, id: 'usr_other', mobile: taken.mobile })).toBe(
        false,
      );
      expect(await repo().findById('usr_other')).toBeNull();
    });

    it('uses uuid-based ids by default', async () => {
      const fresh =
        driver === 'memory'
          ? createMemoryUsersRepo({ clock })
          : createPgUsersRepo({ database: database(), clock, pii });
      const created = await fresh.create({ mobile: '9123456780' });

      expect(created.id).toMatch(/^usr_[0-9a-f-]{36}$/);
    });

    if (driver === 'memory') {
      it('is seeded with the demo user and reset restores it (memory only)', async () => {
        expect(await repo().findById(DEMO_USER.id)).toEqual(DEMO_USER);
        expect(await repo().findByMobile(DEMO_USER.mobile)).toEqual(DEMO_USER);
        await repo().create({ mobile: '9876543210' });
        await repo().update(DEMO_USER.id, { name: 'Changed' });

        await repo().reset();

        expect(await repo().findByMobile('9876543210')).toBeNull();
        expect(await repo().findById(DEMO_USER.id)).toEqual(DEMO_USER);
      });
    } else {
      it('refuses reset: tests truncate the tables as the owner', async () => {
        await expect(repo().reset()).rejects.toThrow(/does not reset/);
      });
    }
  },
);

describe('memory users repo', () => {
  const repo = createMemoryUsersRepo({ clock, newId });

  beforeEach(async () => {
    counter = 0;
    await repo.reset();
  });

  it('starts every case from the seeded state', async () => {
    expect(await repo.findByMobile('9876543210')).toBeNull();
    expect(await repo.findById('usr_1')).toBeNull();
  });
});

describe('users service', () => {
  it('masks the mobile to the last four digits', () => {
    expect(maskMobile('9876543210')).toBe('******3210');
  });

  it('maps a record to a schema-valid public user', () => {
    const user = User.parse(toUser(DEMO_USER));
    expect(user).toEqual({
      id: 'usr_demo',
      mobileMasked: '******0001',
      name: 'Demo Investor',
      email: null,
      kycStatus: 'VERIFIED',
      pinSet: false,
      totpEnabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(user)).not.toContain(DEMO_USER.mobile);
  });
});
