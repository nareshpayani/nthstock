import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import { createActiveSessionsService } from './activeSessionsService.js';
import type { AuthRepo } from './repo.js';
import type { AuthContext, SessionService } from './sessionService.js';

// Logging out the others raises one notice with the count actually ended (NSTOCK-0382).
const clock = manualClock();
const context = { user: { id: 'usr_a' }, session: { id: 'ses_current' } } as AuthContext;

function setup(otherIds: string[], revoke: SessionService['revoke']) {
  const raise = vi.fn(() => Promise.resolve([]));
  const repo = {
    listActiveSessions: () =>
      Promise.resolve([{ id: 'ses_current' }, ...otherIds.map((id) => ({ id }))]),
  } as unknown as AuthRepo;
  const service = createActiveSessionsService({
    clock,
    repo,
    sessions: { revoke } as unknown as SessionService,
    twoFactor: { requireStepUp: vi.fn() },
    notices: { notifier: { raise }, onError: vi.fn() },
  });
  return { service, raise };
}

describe('active sessions service notices', () => {
  it('raises nothing when there are no other sessions', async () => {
    const { service, raise } = setup([], vi.fn());
    expect(await service.revokeOthers(context)).toBe(0);
    expect(raise).not.toHaveBeenCalled();
  });

  it('raises one notice for the sessions ended', async () => {
    const { service, raise } = setup(
      ['ses_1', 'ses_2'],
      vi.fn(() => Promise.resolve()),
    );
    await service.revokeOthers(context);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith([
      expect.objectContaining({ body: expect.stringContaining('2 sessions ended') }),
    ]);
  });

  it('raises the count actually ended when a revoke fails partway', async () => {
    const revoke = vi
      .fn<SessionService['revoke']>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('store down'));
    const { service, raise } = setup(['ses_1', 'ses_2'], revoke);

    await expect(service.revokeOthers(context)).rejects.toThrow('store down');

    expect(raise).toHaveBeenCalledWith([
      expect.objectContaining({ body: expect.stringContaining('1 session ended') }),
    ]);
  });
});
