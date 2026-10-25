import { istDateKey } from '@nthstock/utils';
import type { AccountStore, OrderService } from '../orders/index.js';
import type { PnlSnapshot, PnlSnapshotRepo } from '../portfolio/index.js';
import type { JobResult } from './definitions.js';
import { PricesNotLive } from './sessionJobs.js';

export type PnlSnapshotDeps = {
  orders: Pick<OrderService, 'syncAccounts' | 'portfolioSummary' | 'funds'>;
  accounts: Pick<AccountStore, 'accountsTouchedOn' | 'accountsWithHoldings'>;
  pnlSnapshots: Pick<PnlSnapshotRepo, 'upsert'>;
  /** As for the session jobs: values at stale prices would be wrong, so the run waits. */
  pricesLive?: () => boolean;
};

/**
 * One account's snapshot, read after syncing it from the store (so it takes in what the API
 * wrote since this process last loaded it). Four figures are the portfolio summary's, which
 * totals the holdings rows; realised P&L comes from the cash:
 *   invested = Σ holding cost, currentValue = Σ qty × LTP, dayPnl = Σ qty × (LTP − previous
 *   close), totalPnl = currentValue − invested (unrealised),
 *   realisedPnl = cash balance − opening balance + invested, the P&L booked since the account
 *   opened or was reset (paper trades have no charges, and after the 15:30 close every share
 *   bought is a holding at its cost). The engine clears today's realised P&L at the close, so a
 *   day's realised P&L is the difference between two days' snapshots.
 * `createdAt` is the scheduled time, so a retry or rerun writes the identical row.
 */
async function snapshotOf(
  userId: string,
  at: Date,
  deps: PnlSnapshotDeps,
): Promise<PnlSnapshot | null> {
  const { failed } = await deps.orders.syncAccounts([userId]);
  if (failed > 0) return null;
  const summary = await deps.orders.portfolioSummary(userId);
  const funds = await deps.orders.funds(userId);
  return {
    userId,
    tradeDate: istDateKey(at),
    invested: summary.investedValue,
    currentValue: summary.currentValue,
    dayPnl: summary.dayPnl,
    realisedPnl: funds.balance - funds.openingBalance + summary.investedValue,
    totalPnl: summary.totalPnl,
    createdAt: at,
  };
}

/**
 * 15:45 (T-209): writes `pnl_snapshots` for every account touched on the IST day of `at` or
 * holding stock, upserting on (user_id, trade_date). An account that fails is skipped so the rest
 * are still written; the run then fails so BullMQ retries it (the rows already written are
 * rewritten unchanged).
 */
export async function runPnlSnapshot(at: Date, deps: PnlSnapshotDeps): Promise<JobResult> {
  if (deps.pricesLive && !deps.pricesLive()) {
    throw new PricesNotLive('The quote snapshots are not loaded yet');
  }
  const [touched, holding] = await Promise.all([
    deps.accounts.accountsTouchedOn(istDateKey(at)),
    deps.accounts.accountsWithHoldings(),
  ]);
  let written = 0;
  let failed = 0;
  let firstError: unknown;
  for (const userId of new Set([...touched, ...holding])) {
    try {
      const snapshot = await snapshotOf(userId, at, deps);
      if (snapshot) {
        await deps.pnlSnapshots.upsert(snapshot);
        written += 1;
      } else {
        // syncAccounts has reported why.
        failed += 1;
      }
    } catch (error) {
      // Kept as the cause, not put in the message: the job log must not name the account.
      firstError ??= error;
      failed += 1;
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} of ${written + failed} P&L snapshots were not written`, {
      cause: firstError,
    });
  }
  return { accounts: written };
}
