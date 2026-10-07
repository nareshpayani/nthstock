import { beforeEach, describe, expect, it } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo } from '../audit/repo.js';
import { createMemoryUsersRepo, DEMO_USER } from '../users/repo.js';
import { createMemoryAuthRepo } from './repo.js';
import { createMemorySessionRevocations } from './sessionRevocations.js';
import { createSessionService, type SessionService } from './sessionService.js';

const clock = manualClock();
const repo = createMemoryAuthRepo();
const users = createMemoryUsersRepo({ clock });
const audit = createMemoryAuditRepo({ clock });
let service: SessionService;

beforeEach(async () => {
  await repo.reset();
  await users.reset();
  await audit.reset();
  service = createSessionService({
    clock,
    repo,
    users,
    audit,
    secret: new Uint8Array(32).fill(7),
  });
});

describe('session service', () => {
  it('reuses a known device of the same user and ignores another user’s device', async () => {
    const first = await service.start({ user: DEMO_USER, method: 'OTP', userAgent: undefined });
    const again = await service.start({
      user: DEMO_USER,
      method: 'OTP',
      userAgent: undefined,
      deviceId: first.device.id,
    });
    const other = await users.create({ mobile: '9876543210' });
    const foreign = await service.start({
      user: other,
      method: 'OTP',
      userAgent: undefined,
      deviceId: first.device.id,
    });

    expect(again.device.id).toBe(first.device.id);
    expect(foreign.device.id).not.toBe(first.device.id);
  });

  it('ends the session when its user or device disappears', async () => {
    const created = await users.create({ mobile: '9876543210' });
    const issued = await service.start({ user: created, method: 'OTP', userAgent: undefined });
    await users.reset();

    expect(await service.authenticate(issued.access.token, 'cookie')).toBeNull();
    await expect(service.refresh(issued.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an access token after the session is revoked', async () => {
    const issued = await service.start({ user: DEMO_USER, method: 'OTP', userAgent: undefined });
    expect(await service.authenticate(issued.access.token, 'cookie')).not.toBeNull();

    await service.revoke(issued.session.id, { type: 'user', userId: DEMO_USER.id });

    expect(await service.authenticate(issued.access.token, 'cookie')).toBeNull();
  });

  it('audits a revoked session once as SESSION_REVOKED, and an unknown one not at all (T-188)', async () => {
    const issued = await service.start({ user: DEMO_USER, method: 'PIN', userAgent: undefined });
    const before = (await audit.list()).length;

    await service.revoke(issued.session.id, { type: 'user', userId: DEMO_USER.id });
    await service.revoke('ses_unknown', { type: 'system' });

    const added = (await audit.list()).slice(before);
    expect(added).toEqual([
      expect.objectContaining({
        actor: { type: 'user', userId: DEMO_USER.id },
        userId: DEMO_USER.id,
        action: 'SESSION_REVOKED',
        outcome: 'OK',
        detail: { sessionId: issued.session.id },
      }),
    ]);
    expect((await audit.list())[0]).toMatchObject({
      action: 'LOGIN_SUCCESS',
      detail: { method: 'PIN', sessionId: issued.session.id, deviceId: issued.device.id },
    });
  });

  it('writes last seen at most once a minute, on requests and refreshes (T-194)', async () => {
    const issued = await service.start({ user: DEMO_USER, method: 'OTP', userAgent: undefined });
    const startedAt = clock.now();
    const lastSeen = async () => (await repo.getSession(issued.session.id))?.lastSeenAt;

    clock.advance(59_000);
    await service.authenticate(issued.access.token, 'bearer');
    expect(await lastSeen()).toEqual(startedAt);

    clock.advance(1_000);
    await service.authenticate(issued.access.token, 'bearer');
    expect(await lastSeen()).toEqual(clock.now());
    const touchedAt = clock.now();

    clock.advance(30_000);
    const rotated = await service.refresh(issued.refreshToken);
    expect(await lastSeen()).toEqual(touchedAt);

    clock.advance(30_000);
    await service.refresh(rotated.refreshToken);
    expect(await lastSeen()).toEqual(clock.now());
  });

  it('announces every revocation and refuses a session the cache marks revoked (T-194)', async () => {
    const revocations = createMemorySessionRevocations();
    const announcing = createSessionService({
      clock,
      repo,
      users,
      audit,
      secret: new Uint8Array(32).fill(7),
      revocations,
    });
    const other = await users.create({ mobile: '9876543210' });
    const a = await announcing.start({ user: DEMO_USER, method: 'OTP', userAgent: undefined });
    const b = await announcing.start({ user: other, method: 'OTP', userAgent: undefined });
    const c = await announcing.start({ user: other, method: 'OTP', userAgent: undefined });
    const d = await announcing.start({ user: other, method: 'OTP', userAgent: undefined });

    const context = await announcing.authenticate(a.access.token, 'cookie');
    if (!context) throw new Error('no context');
    await announcing.logout(context);
    await announcing.revoke(b.session.id, { type: 'system' });
    await announcing.refresh(c.refreshToken);
    await expect(announcing.refresh(c.refreshToken)).rejects.toMatchObject({ status: 401 });
    await announcing.revoke('ses_unknown', { type: 'system' });

    expect(revocations.events).toEqual([
      { sessionId: a.session.id, userId: DEMO_USER.id },
      { sessionId: b.session.id, userId: other.id },
      { sessionId: c.session.id, userId: other.id },
    ]);

    // Marked revoked in the cache but not (yet) on the row: refused without reading the row.
    await revocations.revoked({ sessionId: d.session.id, userId: other.id });
    expect((await repo.getSession(d.session.id))?.revokedAt).toBeNull();
    expect(await announcing.authenticate(d.access.token, 'cookie')).toBeNull();
  });
});
