import { MockMarketDataAdapter } from '@nthstock/marketData';
import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { fromIst } from '@nthstock/utils';
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createDeps, type AppDeps } from '../../deps.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { seedDemo } from '../demo/index.js';
import { runPnlSnapshot } from './pnlSnapshot.js';

// The 15:45 job on Postgres (T-209): the demo account is found through its holdings rows, its
// snapshot equals the portfolio summary at close, and a rerun upserts the one row.

const MONDAY_10_00 = fromIst(2026, 9, 28, 10 * 60);
const MONDAY_15_45 = fromIst(2026, 9, 28, 15 * 60 + 45);
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let deps: AppDeps | undefined;
let market: MockMarketDataAdapter | undefined;

afterEach(async () => {
  await deps?.dispose();
  market?.dispose();
  deps = undefined;
  market = undefined;
});

describeWithPostgres('pnl.snapshot on Postgres (integration, T-209)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
  }, 180_000);

  it('snapshots the demo account at close and upserts the same row on a rerun', async () => {
    await pg.truncate();
    const clock = manualClock(MONDAY_10_00);
    market = new MockMarketDataAdapter({ clock, scheduler: noTimers });
    deps = createDeps({ clock, market, dbDriver: 'postgres', databaseUrl: pg.appUrl });
    await seedDemo(deps);
    expect(await deps.repos.accounts.accountsWithHoldings()).toEqual([DEMO_SEED_USER.id]);

    clock.advance(MONDAY_15_45.getTime() - MONDAY_10_00.getTime());
    const jobDeps = {
      orders: deps.orders,
      accounts: deps.repos.accounts,
      pnlSnapshots: deps.repos.pnlSnapshots,
    };
    expect(await runPnlSnapshot(MONDAY_15_45, jobDeps)).toEqual({ accounts: 1 });

    const summary = await deps.orders.portfolioSummary(DEMO_SEED_USER.id);
    const funds = await deps.orders.funds(DEMO_SEED_USER.id);
    const row = await deps.repos.pnlSnapshots.find(DEMO_SEED_USER.id, '2026-09-28');
    expect(row).toEqual({
      userId: DEMO_SEED_USER.id,
      tradeDate: '2026-09-28',
      invested: summary.investedValue,
      currentValue: summary.currentValue,
      dayPnl: summary.dayPnl,
      realisedPnl: funds.balance - funds.openingBalance + summary.investedValue,
      totalPnl: summary.totalPnl,
      createdAt: MONDAY_15_45,
    });

    expect(await runPnlSnapshot(MONDAY_15_45, jobDeps)).toEqual({ accounts: 1 });
    expect(await deps.repos.pnlSnapshots.find(DEMO_SEED_USER.id, '2026-09-28')).toEqual(row);
    const database = deps.database;
    if (!database) throw new Error('no database');
    const counted = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM pnl_snapshots`,
    );
    expect(counted.rows[0]?.count).toBe(1);
  });
});
