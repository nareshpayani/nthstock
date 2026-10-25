import { ACCOUNT_PURGE_AFTER_DAYS } from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import type { AuditRepo } from '../audit/index.js';
import type { OrderService } from '../orders/index.js';
import type { UsersRepo } from '../users/index.js';
import type { AuthRepo } from './repo.js';
import type { AuthContext, SessionService } from './sessionService.js';
import type { TwoFactorService } from './twoFactorService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccountDeletionServiceDeps = {
  clock: Clock;
  repo: AuthRepo;
  users: UsersRepo;
  audit: AuditRepo;
  sessions: SessionService;
  twoFactor: Pick<TwoFactorService, 'requireStepUp'>;
  /** Cancels the account's live paper orders. */
  orders: Pick<OrderService, 'list' | 'cancel'>;
};

export type AccountDeletionService = {
  /** Deletes the signed-in user's account (step-up); resolves to when its data is purged. */
  delete(context: AuthContext): Promise<Date>;
};

/**
 * Account deletion (NSTOCK-0229, spec backend-core §10, DPDP Act 2023): marks the user deleted
 * first, so no login can start a new session, then revokes every session (ACCOUNT_DELETED, each
 * audited and published, so tokens and sockets end at once), cancels live paper orders, and audits
 * ACCOUNT_DELETION_REQUESTED. The data stays for `ACCOUNT_PURGE_AFTER_DAYS`, when the purge job
 * erases it; until then an OTP login for the mobile answers 403 ACCOUNT_DELETED.
 */
export function createAccountDeletionService({
  clock,
  repo,
  users,
  audit,
  sessions,
  twoFactor,
  orders,
}: AccountDeletionServiceDeps): AccountDeletionService {
  async function cancelLiveOrders(userId: string) {
    for (const status of ['OPEN', 'AMO'] as const) {
      // Cancelling shrinks the list, so always read the first page again.
      for (;;) {
        const { items } = await orders.list(userId, { status, limit: 100 });
        if (items.length === 0) break;
        for (const order of items) await orders.cancel(userId, order.id);
      }
    }
  }

  return {
    async delete(context) {
      twoFactor.requireStepUp(context);
      const { user } = context;
      const at = clock.now();
      const purgeAfter = new Date(at.getTime() + ACCOUNT_PURGE_AFTER_DAYS * DAY_MS);
      await users.markDeleted(user.id, at, purgeAfter);

      const actor = { type: 'user' as const, userId: user.id };
      for (const session of await repo.listActiveSessions(user.id, at)) {
        await sessions.revoke(session.id, actor, 'ACCOUNT_DELETED');
      }
      await cancelLiveOrders(user.id);
      await audit.append({
        actor,
        userId: user.id,
        action: 'ACCOUNT_DELETION_REQUESTED',
        orderId: null,
        outcome: 'OK',
        detail: { purgeAfter: purgeAfter.toISOString() },
      });
      return purgeAfter;
    },
  };
}
