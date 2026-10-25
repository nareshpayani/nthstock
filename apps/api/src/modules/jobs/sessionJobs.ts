import { istDateKey } from '@nthstock/utils';
import type { AccountStore, OrderService } from '../orders/index.js';
import type { JobResult } from './definitions.js';

export type SessionJobDeps = {
  orders: Pick<OrderService, 'syncAccounts'>;
  accounts: Pick<AccountStore, 'liveAccountIds' | 'accountsTouchedOn'>;
  /**
   * Whether the process has live prices (the quote service's snapshots); left out, it always
   * has (the in-process adapter). Fills at stale prices would be wrong, so the run waits.
   */
  pricesLive?: () => boolean;
};

/** Thrown while the worker has no live prices yet, so BullMQ retries the run. */
export class PricesNotLive extends Error {
  override name = 'PricesNotLive';
}

/** Syncs every account and fails the run (so BullMQ retries it) when any one did not sync. */
async function syncAll(userIds: Iterable<string>, deps: SessionJobDeps): Promise<JobResult> {
  if (deps.pricesLive && !deps.pricesLive()) {
    throw new PricesNotLive('The quote snapshots are not loaded yet');
  }
  const { synced, failed } = await deps.orders.syncAccounts(userIds);
  if (failed > 0) throw new Error(`${failed} of ${synced + failed} accounts did not sync`);
  return { accounts: synced };
}

/** Accounts with a live order or stop, or with anything that happened on the IST day of `at`. */
async function liveOrTouched(at: Date, deps: SessionJobDeps): Promise<string[]> {
  const [live, touched] = await Promise.all([
    deps.accounts.liveAccountIds(),
    deps.accounts.accountsTouchedOn(istDateKey(at)),
  ]);
  return [...new Set([...live, ...touched])];
}

/**
 * 09:15 (T-208): every account with an AMO order is synced to the open, so its AMOs are released
 * (and market AMOs filled) on time even for users who are not online.
 */
export async function runAmoRelease(_at: Date, deps: SessionJobDeps): Promise<JobResult> {
  return syncAll(await deps.accounts.liveAccountIds(), deps);
}

/**
 * 15:20: accounts with intraday positions (opened by today's fills) or live intraday orders are
 * synced, so the engine squares the positions off and cancels the orders.
 */
export async function runSquareOff(at: Date, deps: SessionJobDeps): Promise<JobResult> {
  return syncAll(await liveOrTouched(at, deps), deps);
}

/**
 * 15:30: the same accounts are synced past the close, so open day orders are cancelled and
 * today's delivery buys settle into holdings (EOD).
 */
export async function runDayClose(at: Date, deps: SessionJobDeps): Promise<JobResult> {
  return syncAll(await liveOrTouched(at, deps), deps);
}
