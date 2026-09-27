import {
  FundsSummary,
  HoldingsResponse,
  LedgerPage,
  OrdersPage,
  WatchlistsResponse,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter } from '@nthstock/marketData';
import { DEMO_SEED_USER, buildDemoAccount, demoWatchlists } from '@nthstock/paperEngine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp, type LoggedIn } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import { demoInstrumentsOf, seedDemo } from './seed.js';

// T-174: DEMO_SEED=true (npm run seed:demo) gives the demo user the shared demo state. The MSW side
// (apps/web/src/mocks/demoSeed.test.ts) checks its answers against the same builders.

/** Monday 28 Sep 2026, 10:00 IST: after the seeded trades, market open. */
const MONDAY_10_00_IST = '2026-09-28T04:30:00.000Z';
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let app: App;
let market: MockMarketDataAdapter;
let demo: LoggedIn;

const get = (url: string) =>
  app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${demo.access}`, 'x-csrf-token': 'bearer' },
  });

beforeEach(async () => {
  const clock = manualClock(MONDAY_10_00_IST);
  market = new MockMarketDataAdapter({ clock, scheduler: noTimers });
  app = buildApp({ deps: { clock, market }, orderSweepMs: null });
  await seedDemo(app.deps);
  demo = await loginWithOtp(app, DEMO_SEED_USER.mobile);
});

afterEach(async () => {
  await app.close();
  market.dispose();
});

describe('seedDemo (T-174)', () => {
  it('logs the demo user in with the dev OTP', () => {
    expect(demo.session.user.id).toBe(DEMO_SEED_USER.id);
  });

  it('gives the demo user the two demo watchlists', async () => {
    const response = await get(routes.watchlistsList.path);
    expect(response.statusCode).toBe(200);
    expect(WatchlistsResponse.parse(response.json()).items).toEqual(
      demoWatchlists(demoInstrumentsOf(market)),
    );
  });

  it('gives the demo user the demo holdings, ledger and orders', async () => {
    const account = buildDemoAccount(demoInstrumentsOf(market));

    const holdings = HoldingsResponse.parse((await get(routes.holdingsList.path)).json()).items;
    const byToken = (a: { token: number }, b: { token: number }) => a.token - b.token;
    expect(
      holdings
        .map(({ token, qty, investedValue }) => ({ token, qty, investedValue }))
        .sort(byToken),
    ).toEqual(
      account.holdings
        .map(({ token, lot }) => ({ token, qty: lot.qty, investedValue: lot.investedValue }))
        .sort(byToken),
    );

    const ledger = LedgerPage.parse((await get(`${routes.fundsLedger.path}?limit=100`)).json());
    expect(ledger.items).toEqual([...account.ledger].reverse());

    const funds = FundsSummary.parse((await get(routes.fundsSummary.path)).json());
    expect(funds.available).toBe(account.ledger.at(-1)?.balanceAfter);

    const orders = OrdersPage.parse((await get(`${routes.ordersList.path}?limit=100`)).json());
    expect(orders.items.map((order) => order.id).sort()).toEqual(
      account.orders.map((order) => order.id).sort(),
    );
  });

  it('does not write the seeded history to the audit log as new fund movements', async () => {
    const movements = (await app.deps.repos.audit.list(DEMO_SEED_USER.id)).filter(
      (entry) => entry.action === 'FUNDS_MOVEMENT',
    );
    expect(movements).toEqual([]);
  });

  it('refuses a market that is not the mock market', () => {
    expect(() => demoInstrumentsOf({} as never)).toThrow(/needs the mock market/);
  });
});
