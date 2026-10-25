import { AccountState, Order, TrailingStop, routes } from '@nthstock/contracts';
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

  it('keeps a trailing stop ratcheting and triggering across a restart (NSTOCK-0368)', async () => {
    await pg.truncate();
    const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
    const boot = () => {
      const market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
      const app = buildApp({
        deps: { clock, market, dbDriver: 'postgres', databaseUrl: pg.appUrl },
        orderSweepMs: null,
      });
      running.push({ app, market });
      return app;
    };
    const tick = async (app: App, price: number) => {
      app.deps.orders.pinPrice(TOKEN, price);
      await app.deps.orders.sweep();
    };

    const before = boot();
    const user = await loginWithOtp(before, '9876543210');
    const headers = { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' };
    const bought = await before.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers,
      payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 5 },
    });
    const fill = Order.parse(bought.json()).avgFillPrice ?? 0;
    const stopPayload = {
      token: TOKEN,
      product: 'DELIVERY',
      trail: { unit: 'AMOUNT', amount: 10_00 },
      activationPrice: null,
      exitOrderType: 'MARKET',
      exitLimitOffset: null,
      clientRequestId: 'ts_restart_1',
    };
    const placed = await before.inject({
      method: 'POST',
      url: routes.trailingStopPlace.path,
      headers,
      payload: stopPayload,
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const stop = TrailingStop.parse(placed.json());
    await tick(before, fill + 30_00);
    await before.close();
    running.splice(0);

    const after = boot();
    await after.ready();
    // The new process's feed starts at its own price: hold the one the stop last saw.
    after.deps.orders.pinPrice(TOKEN, fill + 30_00);
    const again = await loginWithOtp(after, '9876543210');
    const read = async () =>
      AccountState.parse(
        (
          await after.inject({
            method: 'GET',
            url: routes.accountState.path,
            headers: { authorization: `Bearer ${again.access}` },
          })
        ).json(),
      );
    const reloaded = await read();
    expect(reloaded.trailingStops[0]).toMatchObject({ id: stop.id, stopPrice: fill + 20_00 });
    const seqAfterRestart = reloaded.seq;
    expect(seqAfterRestart).toBeGreaterThan(stop.seq);
    expect(reloaded.trailingStops[0]?.status).toBe('TRAILING');

    // The retried place answers with the same stop: the idempotency key survived.
    const retried = await after.inject({
      method: 'POST',
      url: routes.trailingStopPlace.path,
      headers: { authorization: `Bearer ${again.access}`, 'x-csrf-token': 'bearer' },
      payload: stopPayload,
    });
    expect(TrailingStop.parse(retried.json()).id).toBe(stop.id);

    await tick(after, fill + 19_00);
    const done = await read();
    expect(done.trailingStops[0]).toMatchObject({ id: stop.id, status: 'EXECUTED' });
    expect(done.seq).toBeGreaterThan(seqAfterRestart);
    expect(done.positions.find((p) => p.token === TOKEN)?.netQty).toBe(0);
  });

  it('triggers a stop after a restart on ticks alone, with no request from its user (NSTOCK-0368)', async () => {
    await pg.truncate();
    const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
    const boot = () => {
      const market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
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
    const bought = await before.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers,
      payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 3 },
    });
    const fill = Order.parse(bought.json()).avgFillPrice ?? 0;
    const placed = await before.inject({
      method: 'POST',
      url: routes.trailingStopPlace.path,
      headers,
      payload: {
        token: TOKEN,
        product: 'DELIVERY',
        trail: { unit: 'AMOUNT', amount: 10_00 },
        activationPrice: null,
        exitOrderType: 'MARKET',
        exitLimitOffset: null,
      },
    });
    const stop = TrailingStop.parse(placed.json());
    await before.close();
    running.splice(0);

    // The new process loads the account at boot: it has no resting order, only the stop.
    const after = boot();
    await after.ready();
    const updates: TrailingStop[] = [];
    after.deps.orders.onAccountDelta((_userId, delta) => updates.push(...delta.trailingStops));
    after.deps.orders.pinPrice(TOKEN, fill - 11_00);
    await after.deps.orders.sweep();
    expect(updates.map((s) => [s.id, s.status])).toContainEqual([stop.id, 'EXECUTED']);
  });
});
