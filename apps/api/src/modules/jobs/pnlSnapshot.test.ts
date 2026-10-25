import { MockMarketDataAdapter } from '@nthstock/marketData';
import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { fromIst } from '@nthstock/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDeps, type AppDeps } from '../../deps.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import { seedDemo } from '../demo/index.js';
import { createJobs } from './jobs.js';
import { PricesNotLive } from './sessionJobs.js';
import { runPnlSnapshot, type PnlSnapshotDeps } from './pnlSnapshot.js';

// T-209: the 15:45 job writes one pnl_snapshots row per account touched today or holding stock,
// equal to the portfolio summary at close, and a rerun upserts the same row.

/** Monday 28 Sep 2026, a trading day: 10:00 IST (market open) and 15:45 IST (the job). */
const MONDAY_10_00 = fromIst(2026, 9, 28, 10 * 60);
const MONDAY_15_45 = fromIst(2026, 9, 28, 15 * 60 + 45);
const TRADE_DATE = '2026-09-28';
const TRADER = 'usr_trader';
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let clock: ManualClock;
let market: MockMarketDataAdapter;
let deps: AppDeps;

const jobDeps = (overrides: Partial<PnlSnapshotDeps> = {}): PnlSnapshotDeps => ({
  orders: deps.orders,
  accounts: deps.repos.accounts,
  pnlSnapshots: deps.repos.pnlSnapshots,
  ...overrides,
});

/** An intraday round trip for `TRADER`, bought at the LTP and sold ₹5 higher. */
async function tradeIntraday(): Promise<number> {
  const token = market.master.equities[0]?.instrument.token ?? 0;
  const order = { token, type: 'MARKET', product: 'INTRADAY', qty: 10 } as const;
  const bought = await deps.orders.place(TRADER, { ...order, side: 'BUY' });
  if (bought.status !== 'EXECUTED') throw new Error('the buy did not fill');
  const price = deps.orders.ltp(token) ?? 0;
  deps.orders.pinPrice(token, price + 5_00);
  const sold = await deps.orders.place(TRADER, { ...order, side: 'SELL' });
  if (sold.status !== 'EXECUTED') throw new Error('the sell did not fill');
  return 10 * 5_00;
}

beforeEach(async () => {
  clock = manualClock(MONDAY_10_00);
  market = new MockMarketDataAdapter({ clock, scheduler: noTimers });
  deps = createDeps({ clock, market });
  await seedDemo(deps);
});

afterEach(async () => {
  await deps.dispose();
  market.dispose();
});

describe('pnl.snapshot (T-209)', () => {
  it('is one of the scheduled jobs, at 15:45 IST on trading days', () => {
    const jobs = createJobs({
      ...jobDeps(),
      accounts: deps.repos.accounts,
      database: null,
      auth: deps.repos.auth,
    });
    const job = jobs.find((candidate) => candidate.name === 'pnl.snapshot');
    expect(job?.schedule).toEqual({ cron: '45 15 * * 1-5', tradingDaysOnly: true });
  });

  it('writes the portfolio summary at close for the demo account, and a rerun upserts it', async () => {
    clock.advance(MONDAY_15_45.getTime() - MONDAY_10_00.getTime());

    expect(await runPnlSnapshot(MONDAY_15_45, jobDeps())).toEqual({ accounts: 1 });

    const summary = await deps.orders.portfolioSummary(DEMO_SEED_USER.id);
    const funds = await deps.orders.funds(DEMO_SEED_USER.id);
    expect(summary.holdingsCount).toBeGreaterThan(0);
    const row = await deps.repos.pnlSnapshots.find(DEMO_SEED_USER.id, TRADE_DATE);
    expect(row).toEqual({
      userId: DEMO_SEED_USER.id,
      tradeDate: TRADE_DATE,
      invested: summary.investedValue,
      currentValue: summary.currentValue,
      dayPnl: summary.dayPnl,
      realisedPnl: funds.balance - funds.openingBalance + summary.investedValue,
      totalPnl: summary.totalPnl,
      createdAt: MONDAY_15_45,
    });

    expect(await runPnlSnapshot(MONDAY_15_45, jobDeps())).toEqual({ accounts: 1 });
    expect(await deps.repos.pnlSnapshots.find(DEMO_SEED_USER.id, TRADE_DATE)).toEqual(row);
  });

  it('includes an account touched today without holdings, with its realised P&L', async () => {
    const realised = await tradeIntraday();
    clock.advance(MONDAY_15_45.getTime() - MONDAY_10_00.getTime());

    expect(await runPnlSnapshot(MONDAY_15_45, jobDeps())).toEqual({ accounts: 2 });
    expect(await deps.repos.pnlSnapshots.find(TRADER, TRADE_DATE)).toMatchObject({
      invested: 0,
      currentValue: 0,
      dayPnl: 0,
      totalPnl: 0,
      realisedPnl: realised,
    });
  });

  it('books a part sold today as realised and the rest as a holding at its cost', async () => {
    const token = market.master.equities[1]?.instrument.token ?? 0;
    const order = { token, type: 'MARKET', product: 'DELIVERY' } as const;
    const bought = await deps.orders.place(TRADER, { ...order, side: 'BUY', qty: 10 });
    const cost = bought.avgFillPrice ?? 0;
    deps.orders.pinPrice(token, cost + 5_00);
    await deps.orders.place(TRADER, { ...order, side: 'SELL', qty: 4 });
    clock.advance(MONDAY_15_45.getTime() - MONDAY_10_00.getTime());

    await runPnlSnapshot(MONDAY_15_45, jobDeps());
    expect(await deps.repos.pnlSnapshots.find(TRADER, TRADE_DATE)).toMatchObject({
      invested: 6 * cost,
      currentValue: 6 * (cost + 5_00),
      totalPnl: 6 * 5_00,
      realisedPnl: 4 * 5_00,
    });
  });

  it('writes the other accounts, then fails the run, when one does not sync', async () => {
    await tradeIntraday();
    clock.advance(MONDAY_15_45.getTime() - MONDAY_10_00.getTime());
    const orders: PnlSnapshotDeps['orders'] = {
      ...deps.orders,
      syncAccounts: async (userIds) =>
        [...userIds].includes(TRADER)
          ? { synced: 0, failed: 1 }
          : deps.orders.syncAccounts(userIds),
    };

    await expect(runPnlSnapshot(MONDAY_15_45, jobDeps({ orders }))).rejects.toThrow(
      '1 of 2 P&L snapshots were not written',
    );
    expect(await deps.repos.pnlSnapshots.find(DEMO_SEED_USER.id, TRADE_DATE)).not.toBeNull();
    expect(await deps.repos.pnlSnapshots.find(TRADER, TRADE_DATE)).toBeNull();
  });

  it('waits for live prices: no row is written at stale prices', async () => {
    clock.advance(MONDAY_15_45.getTime() - MONDAY_10_00.getTime());
    let writes = 0;
    const deps = jobDeps({
      pricesLive: () => false,
      pnlSnapshots: {
        upsert: () => {
          writes += 1;
          return Promise.resolve();
        },
      },
    });
    await expect(runPnlSnapshot(MONDAY_15_45, deps)).rejects.toBeInstanceOf(PricesNotLive);
    expect(writes).toBe(0);
  });

  it('fails the run without naming the account when a write fails', async () => {
    clock.advance(MONDAY_15_45.getTime() - MONDAY_10_00.getTime());
    const cause = new Error('pnl_snapshots is down');
    const run = runPnlSnapshot(
      MONDAY_15_45,
      jobDeps({ pnlSnapshots: { upsert: () => Promise.reject(cause) } }),
    );

    const error: unknown = await run.catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('1 of 1 P&L snapshots were not written');
    expect((error as Error).message).not.toContain(DEMO_SEED_USER.id);
    expect((error as Error).cause).toBe(cause);
  });
});
