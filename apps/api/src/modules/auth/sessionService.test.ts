import { beforeEach, describe, expect, it } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryUsersRepo, DEMO_USER } from '../users/repo.js';
import { createMemoryAuthRepo } from './repo.js';
import { createSessionService, type SessionService } from './sessionService.js';

const clock = manualClock();
const repo = createMemoryAuthRepo();
const users = createMemoryUsersRepo({ clock });
let service: SessionService;

beforeEach(async () => {
  await repo.reset();
  await users.reset();
  service = createSessionService({ clock, repo, users, secret: new Uint8Array(32).fill(7) });
});

describe('session service', () => {
  it('reuses a known device of the same user and ignores another user’s device', async () => {
    const first = await service.start({ user: DEMO_USER, userAgent: undefined });
    const again = await service.start({
      user: DEMO_USER,
      userAgent: undefined,
      deviceId: first.device.id,
    });
    const other = await users.create({ mobile: '9876543210' });
    const foreign = await service.start({
      user: other,
      userAgent: undefined,
      deviceId: first.device.id,
    });

    expect(again.device.id).toBe(first.device.id);
    expect(foreign.device.id).not.toBe(first.device.id);
  });

  it('ends the session when its user or device disappears', async () => {
    const created = await users.create({ mobile: '9876543210' });
    const issued = await service.start({ user: created, userAgent: undefined });
    await users.reset();

    expect(await service.authenticate(issued.access.token)).toBeNull();
    await expect(service.refresh(issued.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an access token after the session is revoked', async () => {
    const issued = await service.start({ user: DEMO_USER, userAgent: undefined });
    expect(await service.authenticate(issued.access.token)).not.toBeNull();

    await service.revoke(issued.session.id);

    expect(await service.authenticate(issued.access.token)).toBeNull();
  });
});
