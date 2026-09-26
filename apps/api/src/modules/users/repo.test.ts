import { User } from '@nthstock/contracts';
import { fixedClock } from '@nthstock/utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_USER, createMemoryUsersRepo } from './repo.js';
import { maskMobile, toUser } from './service.js';

const clock = fixedClock('2026-09-25T04:00:00.000Z');
let counter = 0;
const repo = createMemoryUsersRepo({ clock, newId: () => `usr_${++counter}` });

describe('memory users repo', () => {
  beforeEach(async () => {
    counter = 0;
    await repo.reset();
  });

  it('is seeded with the demo user', async () => {
    const demo = await repo.findById(DEMO_USER.id);
    expect(demo).toEqual(DEMO_USER);
    expect(await repo.findByMobile(DEMO_USER.mobile)).toEqual(DEMO_USER);
  });

  it('creates a user stamped by the injected clock', async () => {
    const created = await repo.create({ mobile: '9876543210' });

    expect(created).toMatchObject({
      id: 'usr_1',
      mobile: '9876543210',
      name: null,
      kycStatus: 'NOT_STARTED',
      pinSet: false,
    });
    expect(created.createdAt.toISOString()).toBe('2026-09-25T04:00:00.000Z');
    expect(await repo.findByMobile('9876543210')).toEqual(created);
  });

  it('starts every case from the seeded state', async () => {
    // Would fail if the previous case's user leaked through reset().
    expect(await repo.findByMobile('9876543210')).toBeNull();
    expect(await repo.findById('usr_1')).toBeNull();
  });

  it('rejects a second user with the same mobile', async () => {
    await expect(repo.create({ mobile: DEMO_USER.mobile })).rejects.toThrow(/already exists/);
  });

  it('updates a user and returns null for an unknown id', async () => {
    const updated = await repo.update(DEMO_USER.id, { pinSet: true, name: 'Asha' });
    expect(updated).toMatchObject({ pinSet: true, name: 'Asha', mobile: DEMO_USER.mobile });
    expect(await repo.update('usr_missing', { pinSet: true })).toBeNull();
  });

  it('hands out copies, so callers cannot change stored users', async () => {
    const demo = await repo.findById(DEMO_USER.id);
    if (!demo) throw new Error('demo user missing');
    demo.name = 'Mallory';
    demo.createdAt.setUTCFullYear(1999);

    expect(await repo.findById(DEMO_USER.id)).toEqual(DEMO_USER);
  });

  it('uses uuid-based ids by default', async () => {
    const fresh = createMemoryUsersRepo({ clock });
    const created = await fresh.create({ mobile: '9123456789', name: 'Ravi', email: null });
    expect(created.id).toMatch(/^usr_[0-9a-f-]{36}$/);
    expect(created.name).toBe('Ravi');
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
