import type { CursorQuery, FundsSummary, LedgerPage, ResetRequest } from '@nthstock/contracts';
import type { OrderService } from '../orders/index.js';
import type { FundsUserId } from './schema.js';

export type FundsServiceDeps = {
  /**
   * The paper accounts: funds live in each user's engine on the orders module's desk, and the
   * reset's audit entry is committed with the changes it caused.
   */
  orders: Pick<OrderService, 'funds' | 'ledger' | 'reset'>;
};

export type FundsService = ReturnType<typeof createFundsService>;

/**
 * Paper funds (T-131, T-155): the summary, the ledger newest first by cursor, and the reset. Every
 * ledger entry is written to the audit log as a fund movement by the orders module; a reset is
 * audited here as well, with what it cleared and the balance it restored.
 */
export function createFundsService({ orders }: FundsServiceDeps) {
  return {
    summary: (userId: FundsUserId): Promise<FundsSummary> => orders.funds(userId),

    ledger: (userId: FundsUserId, query: CursorQuery): Promise<LedgerPage> =>
      orders.ledger(userId, query),

    /** One commit: the cancellations, the RESET movement and the FUNDS_RESET entry (T-205). */
    reset: (userId: FundsUserId, request: ResetRequest): Promise<FundsSummary> =>
      orders.reset(userId, (funds) => ({
        actor: { type: 'user', userId },
        userId,
        action: 'FUNDS_RESET',
        orderId: null,
        outcome: 'OK',
        detail: { request, balance: funds.balance, available: funds.available },
      })),
  };
}
