import type { CursorQuery, FundsSummary, LedgerPage, ResetRequest } from '@nthstock/contracts';
import type { OrderService } from '../orders/service.js';
import type { FundsUserId } from './schema.js';

export type FundsServiceDeps = {
  /**
   * The paper accounts: funds live in each user's engine on the orders module's desk, and the
   * reset's audit entry goes through the same ordered audit queue as the changes it caused.
   */
  orders: Pick<OrderService, 'funds' | 'ledger' | 'reset' | 'audit'>;
};

export type FundsService = ReturnType<typeof createFundsService>;

/**
 * Paper funds (T-131, T-155): the summary, the ledger newest first by cursor, and the reset. Every
 * ledger entry is written to the audit log as a fund movement by the orders module; a reset is
 * audited here as well, with what it cleared and the balance it restored.
 */
export function createFundsService({ orders }: FundsServiceDeps) {
  return {
    summary: (userId: FundsUserId): FundsSummary => orders.funds(userId),

    ledger: (userId: FundsUserId, query: CursorQuery): LedgerPage => orders.ledger(userId, query),

    async reset(userId: FundsUserId, request: ResetRequest): Promise<FundsSummary> {
      const funds = orders.reset(userId);
      await orders.audit(userId, [
        {
          actor: { type: 'user', userId },
          userId,
          action: 'FUNDS_RESET',
          orderId: null,
          outcome: 'OK',
          detail: { request, balance: funds.balance, available: funds.available },
        },
      ]);
      return funds;
    },
  };
}
