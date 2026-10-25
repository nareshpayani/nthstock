import { Order, routes } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';

// The account store is the record and the engines a cache (spec backend-core §5.3, T-204): a
// resting order outlives the apps/api process that took it.

const master = generateSymbolMaster({ equityCount: 20 });
const EQUITY = master.equities[0]?.instrument;
const TOKEN = EQUITY?.token ?? 0;
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

const running: { app: App; market: MockMarketDataAdapter }[] = [];

afterEach(async () => {
  for (const { app, market } of running.splice(0)) {
    await app.close();
    market.dispose();
  }
});

describeWithPostgres('orders across an apps/api restart (integration, T-204)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
  }, 180_000);

  it('fills a LIMIT order placed before a restart on the crossing tick after it', async () => {
    await pg.truncate();
    const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
    let market: MockMarketDataAdapter | undefined;
    const boot = () => {
      market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
      const app = buildApp({
        deps: { clock, market, dbDriver: 'postgres', databaseUrl: pg.appUrl },
        orderSweepMs: null,
      });
      running.push({ app, market });
      return app;
    };

    const before = boot();
    const user = await loginWithOtp(before, '9876543210');
    const headers = { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' };
    const quote = await market?.getQuote(EQUITY?.symbol ?? '');
    if (!quote) throw new Error('no quote');
    // Below the LTP, so the BUY rests OPEN until the price comes down to it.
    const price = quote.ltp - 1_000;
    const response = await before.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers,
      payload: { token: TOKEN, side: 'BUY', type: 'LIMIT', product: 'DELIVERY', qty: 2, price },
    });
    expect(response.statusCode, response.body).toBe(200);
    const placed = Order.parse(response.json());
    expect(placed.status).toBe('OPEN');
    await before.close();
    running.splice(0);

    const after = boot();
    await after.ready();
    const updates: Order[] = [];
    after.deps.orders.onOrderUpdate((_userId, order) => updates.push(order));

    after.deps.orders.pinPrice(TOKEN, price);
    await after.deps.orders.sweep();

    expect(updates.map((order) => [order.id, order.status])).toEqual([[placed.id, 'EXECUTED']]);
    // Each test app signs its own tokens: log in to the new one.
    const again = await loginWithOtp(after, '9876543210');
    expect(again.session.user.id).toBe(user.session.user.id);
    const stored = await after.inject({
      method: 'GET',
      url: `/v1/orders/${placed.id}`,
      headers: { authorization: `Bearer ${again.access}` },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    expect(Order.parse(stored.json())).toMatchObject({ status: 'EXECUTED', filledQty: 2 });
  });
});
