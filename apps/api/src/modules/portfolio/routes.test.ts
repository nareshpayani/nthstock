import {
  ApiError,
  HoldingsResponse,
  Order,
  OrderHistoryResponse,
  PortfolioSummary,
  PositionsResponse,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp, type LoggedIn } from '../../test/authFlow.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const MONDAY_10_00_IST = '2026-09-28T04:30:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

const master = generateSymbolMaster({ equityCount: 60 });
const equity = master.equities[0]?.instrument;
if (!equity) throw new Error('no equity in the test master');
const TOKEN = equity.token;

/** Ticks only when the test calls `market.tick()`. */
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let app: App;
let clock: ManualClock;
let market: MockMarketDataAdapter;
let user: LoggedIn;
const MOBILE = '9876543210';

beforeEach(async () => {
  clock = manualClock(MONDAY_10_00_IST);
  market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  app = buildApp({ deps: { clock, market }, orderSweepMs: null });
  user = await loginWithOtp(app, MOBILE);
});

afterEach(async () => {
  await app.close();
  market.dispose();
});

const bearer = (who: LoggedIn) => ({
  authorization: `Bearer ${who.access}`,
  'x-csrf-token': 'bearer',
});

const get = (url: string, who: LoggedIn = user) =>
  app.inject({ method: 'GET', url, headers: bearer(who) });

const buy = async (qty: number, extra: Record<string, unknown> = {}) =>
  Order.parse(
    (
      await app.inject({
        method: 'POST',
        url: routes.orderPlace.path,
        headers: bearer(user),
        payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty, ...extra },
      })
    ).json(),
  );

describe('portfolio routes (T-141)', () => {
  it('need a session', async () => {
    for (const path of [
      routes.positionsList.path,
      routes.holdingsList.path,
      routes.portfolioSummary.path,
    ]) {
      const response = await app.inject({ method: 'GET', url: path });
      expect(response.statusCode, path).toBe(401);
      expect(ApiError.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    }
  });

  it('value today’s positions at the LTP and mark them to the next tick', async () => {
    const order = await buy(10);
    const bought = order.avgFillPrice ?? 0;
    const first = PositionsResponse.parse((await get(routes.positionsList.path)).json());
    expect(first.items).toEqual([
      {
        token: TOKEN,
        symbol: equity.symbol,
        exchange: equity.exchange,
        product: 'DELIVERY',
        netQty: 10,
        buyQty: 10,
        sellQty: 0,
        avgBuyPrice: bought,
        avgSellPrice: 0,
        ltp: bought,
        realisedPnl: 0,
        unrealisedPnl: 0,
      },
    ]);

    app.deps.orders.pinPrice(TOKEN, bought + 1_00);
    const second = PositionsResponse.parse((await get(routes.positionsList.path)).json());
    expect(second.items[0]).toMatchObject({ ltp: bought + 1_00, unrealisedPnl: 10 * 1_00 });
    // Nothing is carried over yet: holdings are empty until the close.
    expect(HoldingsResponse.parse((await get(routes.holdingsList.path)).json()).items).toEqual([]);
  });

  it('carry delivery buys into holdings after the close, and sum them in the summary', async () => {
    const order = await buy(4);
    const cost = 4 * (order.avgFillPrice ?? 0);
    clock.advance(DAY_MS);
    user = await loginWithOtp(app, MOBILE); // the access token of yesterday has expired
    const price = (order.avgFillPrice ?? 0) + 2_00;
    app.deps.orders.pinPrice(TOKEN, price);

    const holdings = HoldingsResponse.parse((await get(routes.holdingsList.path)).json()).items;
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      token: TOKEN,
      symbol: equity.symbol,
      qty: 4,
      avgPrice: order.avgFillPrice,
      ltp: price,
      investedValue: cost,
      currentValue: 4 * price,
      pnl: 4 * 2_00,
    });
    const summary = PortfolioSummary.parse((await get(routes.portfolioSummary.path)).json());
    expect(summary).toMatchObject({
      investedValue: cost,
      currentValue: 4 * price,
      totalPnl: 4 * 2_00,
      dayPnl: holdings[0]?.dayChange,
      holdingsCount: 1,
      positionsCount: 0,
      asOf: clock.now().toISOString(),
    });
  });

  it('answer another user with their own, empty, portfolio', async () => {
    await buy(1);
    const other = await loginWithOtp(app, '9876500000');
    const positions = PositionsResponse.parse((await get(routes.positionsList.path, other)).json());
    expect(positions.items).toEqual([]);
    const summary = PortfolioSummary.parse((await get(routes.portfolioSummary.path, other)).json());
    expect(summary).toMatchObject({ holdingsCount: 0, positionsCount: 0, investedValue: 0 });
  });
});

describe('order history route (T-146)', () => {
  it('lists every change of the caller’s order, and 404s for anyone else', async () => {
    const order = await buy(2);
    const history = OrderHistoryResponse.parse(
      (await get(`/v1/orders/${order.id}/history`)).json(),
    );
    expect(history.orderId).toBe(order.id);
    expect(history.items.map((e) => [e.event, e.status])).toEqual([
      ['PLACED', 'OPEN'],
      ['EXECUTED', 'EXECUTED'],
    ]);
    const other = await loginWithOtp(app, '9876500001');
    const response = await get(`/v1/orders/${order.id}/history`, other);
    expect(response.statusCode).toBe(404);
    expect(ApiError.parse(response.json()).error.code).toBe('NOT_FOUND');
  });
});
