import {
  CONSENT_POLICY_VERSION,
  FundsSummary,
  HoldingsResponse,
  LedgerPage,
  OrdersPage,
  WatchlistsResponse,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter } from '@nthstock/marketData';
import { DEMO_SEED_USER, buildDemoAccount, demoWatchlists } from '@nthstock/paperEngine';
import { Client } from 'pg';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { DEMO_USER } from '../users/index.js';
import { demoInstrumentsOf, seedDemo } from './seed.js';

// NSTOCK-0239: on DB_DRIVER=postgres the demo seed writes the demo user, their consent, watchlists
// and paper account to Postgres. Seeding twice gives the same state, a fresh apps/api reads it back,
// and the answers equal the shared demo builders (the ones MSW's ?demo=1 checks against).

/** Monday 28 Sep 2026, 10:00 IST: after the seeded trades, market open. */
const MONDAY_10_00_IST = '2026-09-28T04:30:00.000Z';
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

const running: { app: App; market: MockMarketDataAdapter }[] = [];

afterEach(async () => {
  for (const { app, market } of running.splice(0)) {
    await app.close();
    market.dispose();
  }
});

describeWithPostgres('the demo seed on Postgres (integration, NSTOCK-0239)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
  }, 180_000);

  const boot = () => {
    const clock = manualClock(MONDAY_10_00_IST);
    const market = new MockMarketDataAdapter({ clock, scheduler: noTimers });
    const app = buildApp({
      deps: { clock, market, dbDriver: 'postgres', databaseUrl: pg.appUrl },
      orderSweepMs: null,
    });
    running.push({ app, market });
    return { app, market };
  };

  /** Everything the demo user sees, read over REST from a fresh login. */
  async function demoState(app: App) {
    const { access } = await loginWithOtp(app, DEMO_SEED_USER.mobile);
    const get = async (url: string) => {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${access}`, 'x-csrf-token': 'bearer' },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as unknown;
    };
    const holdings = HoldingsResponse.parse(await get(routes.holdingsList.path)).items.map(
      ({ token, qty, investedValue }) => ({ token, qty, investedValue }),
    );
    return {
      watchlists: WatchlistsResponse.parse(await get(routes.watchlistsList.path)).items,
      holdings: holdings.sort((a, b) => a.token - b.token),
      ledger: LedgerPage.parse(await get(`${routes.fundsLedger.path}?limit=100`)).items,
      available: FundsSummary.parse(await get(routes.fundsSummary.path)).available,
      orders: OrdersPage.parse(await get(`${routes.ordersList.path}?limit=100`)).items.map(
        ({ id, status, filledQty }) => ({ id, status, filledQty }),
      ),
    };
  }

  it('seeds twice to the same state, read back after a restart', async () => {
    await pg.truncate();
    const first = boot();
    await seedDemo(first.app.deps);
    const seeded = await demoState(first.app);

    const instruments = demoInstrumentsOf(first.market);
    const account = buildDemoAccount(instruments);
    expect(seeded.watchlists).toEqual(demoWatchlists(instruments));
    expect(seeded.ledger).toEqual([...account.ledger].reverse());
    expect(seeded.available).toBe(account.ledger.at(-1)?.balanceAfter);
    expect(seeded.holdings).toHaveLength(account.holdings.length);

    await seedDemo(first.app.deps);
    expect(await demoState(first.app)).toEqual(seeded);

    // A fresh process seeds again over the stored state, and still answers the same.
    const second = boot();
    await second.app.ready();
    await seedDemo(second.app.deps);
    expect(await demoState(second.app)).toEqual(seeded);

    const owner = new Client({ connectionString: pg.ownerUrl });
    await owner.connect();
    try {
      const { rows } = await owner.query<{ id: string }>('SELECT id FROM users');
      expect(rows).toEqual([{ id: DEMO_USER.id }]);
    } finally {
      await owner.end();
    }
    expect(await second.app.deps.repos.users.listConsents(DEMO_USER.id)).toEqual([
      {
        purpose: 'TERMS_AND_PRIVACY',
        policyVersion: CONSENT_POLICY_VERSION,
        grantedAt: DEMO_USER.createdAt,
        withdrawnAt: null,
      },
    ]);
  });
});
