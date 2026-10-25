import type { ActiveSession } from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import { raiseSecurityNotice, type SecurityNotices } from '../notifications/index.js';
import type { AuthRepo, DeviceRecord } from './repo.js';
import type { AuthContext, SessionService } from './sessionService.js';
import type { TwoFactorService } from './twoFactorService.js';

export type ActiveSessionsServiceDeps = {
  clock: Clock;
  repo: AuthRepo;
  sessions: SessionService;
  twoFactor: Pick<TwoFactorService, 'requireStepUp'>;
  /** Logging out the other devices raises a security notification (NSTOCK-0382). */
  notices?: SecurityNotices;
};

export type ActiveSessionsService = {
  list(context: AuthContext): Promise<ActiveSession[]>;
  /** Logs out one other session (step-up). The current one logs out instead: 400. */
  revoke(context: AuthContext, sessionId: string): Promise<void>;
  /** Logs out every session but the current one (step-up); resolves to how many. */
  revokeOthers(context: AuthContext): Promise<number>;
};

/**
 * Active sessions (NSTOCK-0223, spec backend-core §7.5): the user's live sessions with their
 * device, and logging out the others. Each revoke goes through `SessionService.revoke`, so it is
 * recorded on the row, audited as SESSION_REVOKED and published as `auth:sessionRevoked`, which
 * closes that session's sockets and refuses its access and refresh tokens at once.
 */
export function createActiveSessionsService({
  clock,
  repo,
  sessions,
  twoFactor,
  notices,
}: ActiveSessionsServiceDeps): ActiveSessionsService {
  const others = async (context: AuthContext) =>
    (await repo.listActiveSessions(context.user.id, clock.now())).filter(
      (s) => s.id !== context.session.id,
    );

  return {
    async list(context) {
      const live = await repo.listActiveSessions(context.user.id, clock.now());
      const devices = new Map<string, DeviceRecord | null>();
      for (const { deviceId } of live) {
        if (!devices.has(deviceId)) devices.set(deviceId, await repo.getDevice(deviceId));
      }
      return live.map((s) => {
        const device = devices.get(s.deviceId);
        return {
          id: s.id,
          deviceLabel: device?.label ?? 'Unknown device',
          trusted: device?.trusted ?? false,
          current: s.id === context.session.id,
          createdAt: s.createdAt.toISOString(),
          lastActiveAt: s.lastSeenAt.toISOString(),
        };
      });
    },

    async revoke(context, sessionId) {
      if (sessionId === context.session.id) {
        throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Use Log out to end this session.');
      }
      twoFactor.requireStepUp(context);
      const target = (await others(context)).find((s) => s.id === sessionId);
      // Another user's session reads the same as one that does not exist.
      if (!target) throw new ApiHttpError(404, 'NOT_FOUND', 'That session has already ended.');
      await sessions.revoke(target.id, { type: 'user', userId: context.user.id });
    },

    async revokeOthers(context) {
      twoFactor.requireStepUp(context);
      const targets = await others(context);
      for (const target of targets) {
        await sessions.revoke(target.id, { type: 'user', userId: context.user.id });
      }
      if (targets.length > 0) {
        raiseSecurityNotice(
          notices,
          context.user.id,
          { type: 'SESSIONS_ENDED', count: targets.length },
          clock.now(),
        );
      }
      return targets.length;
    },
  };
}
