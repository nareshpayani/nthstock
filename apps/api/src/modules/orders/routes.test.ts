import {
  ApiError,
  FundsSummary,
  Order,
  OrdersPage,
  PAPER_OPENING_BALANCE_PAISE,
  routes,
  type PlaceOrderRequest,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp, type LoggedIn } from '../../test/authFlow.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const MARKET_OPEN_UTC = '2026-09-28T04:30:00.000Z';
/** The same Monday, 20:00 IST: closed, so orders are AMO. */
const EVENING_UTC = '2026-09-28T14:30:00.000Z';

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

async function start(at = MARKET_OPEN_UTC) {
  clock = manualClock(at);
  market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  app = buildApp({ deps: { clock, market }, orderSweepMs: null });
  user = await loginWithOtp(app, '9876543210');
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  await app.close();
  market.dispose();
});

/** A Bearer token; writes still carry a CSRF header (any value goes with a Bearer token). */
const bearer = (who: LoggedIn = user) => ({
  authorization: `Bearer ${who.access}`,
  'x-csrf-token': 'bearer',
});

const place = (body: Partial<PlaceOrderRequest>, who: LoggedIn = user) =>
  app.inject({
    method: 'POST',
    url: routes.orderPlace.path,
    headers: bearer(who),
    payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1, ...body },
  });

const get = (url: string, who: LoggedIn = user) =>
  app.inject({ method: 'GET', url, headers: bearer(who) });

async function ltp() {
  const quote = await market.getQuote(equity?.symbol ?? '');
  if (!quote) throw new Error('no quote');
  return quote.ltp;
}

/** The limit one tick below the LTP, so a BUY rests OPEN until the price comes down to it. */
const belowLtp = async () => (await ltp()) - 5;

describe('order routes (T-131)', () => {
  it('fills a MARKET order at the LTP, well within 300 ms, and audits it', async () => {
    await place({ qty: 1 }); // warm up: symbol master, stats and quote for the token
    const price = await ltp();
    const startedAt = performance.now();
    const response = await place({ qty: 2 });
    const elapsed = performance.now() - startedAt;

    expect(response.statusCode).toBe(200);
    const order = Order.parse(response.json());
    expect(order).toMatchObject({ status: 'EXECUTED', avgFillPrice: price, filledQty: 2 });
    expect(elapsed).toBeLessThan(300);

    const audit = await app.deps.repos.audit.list(user.session.user.id);
    const mine = audit.filter((entry) => entry.orderId === order.id);
    expect(mine.map((entry) => [entry.action, entry.actor.type, entry.outcome])).toEqual([
      ['ORDER_UPDATE', 'system', 'OK'], // stored OPEN
      ['ORDER_UPDATE', 'system', 'OK'], // filled
      ['ORDER_PLACE', 'user', 'OK'],
    ]);
    expect(mine.at(-1)?.detail).toMatchObject({ status: 'EXECUTED' });
  });

  it('fills a LIMIT order on the adapter tick that crosses it', async () => {
    const limit = await belowLtp();
    const placed = Order.parse((await place({ type: 'LIMIT', price: limit, qty: 3 })).json());
    expect(placed.status).toBe('OPEN');
    const updates: string[] = [];
    app.deps.orders.onOrderUpdate((userId, order) => updates.push(`${userId}:${order.status}`));

    for (let i = 0; i < 2_000 && (await ltp()) > limit; i += 1) market.tick();
    expect(await ltp()).toBeLessThanOrEqual(limit);

    const filled = Order.parse((await get(`/v1/orders/${placed.id}`)).json());
    expect(filled).toMatchObject({ status: 'EXECUTED', avgFillPrice: limit, filledQty: 3 });
    expect(updates).toEqual([`${user.session.user.id}:EXECUTED`]);
  }, 30_000);

  it('lists by status, newest first, with a cursor; a bad cursor is a 400', async () => {
    const limit = await belowLtp();
    const open1 = Order.parse((await place({ type: 'LIMIT', price: limit - 100 })).json());
    const open2 = Order.parse((await place({ type: 'LIMIT', price: limit - 200 })).json());
    const filled = Order.parse((await place({})).json());

    const all = OrdersPage.parse((await get('/v1/orders')).json());
    expect(all.items.map((o) => o.id)).toEqual([filled.id, open2.id, open1.id]);
    const open = OrdersPage.parse((await get('/v1/orders?status=OPEN&limit=1')).json());
    expect(open).toEqual({ items: [open2], nextCursor: open2.id });
    const next = OrdersPage.parse(
      (await get(`/v1/orders?status=OPEN&limit=1&cursor=${open.nextCursor ?? ''}`)).json(),
    );
    expect(next).toEqual({ items: [open1], nextCursor: null });
    const executed = OrdersPage.parse((await get('/v1/orders?status=EXECUTED')).json());
    expect(executed.items.map((o) => o.id)).toEqual([filled.id]);

    const bad = await get('/v1/orders?cursor=nope');
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('modifies and cancels an open order, blocking and releasing cash, and audits each', async () => {
    const limit = await belowLtp();
    const placed = Order.parse((await place({ type: 'LIMIT', price: limit - 100, qty: 4 })).json());
    const funds = async () => FundsSummary.parse((await get(routes.fundsSummary.path)).json());
    expect((await funds()).blocked).toBe(4 * (limit - 100));

    const modified = await app.inject({
      method: 'PATCH',
      url: `/v1/orders/${placed.id}`,
      headers: bearer(),
      payload: { qty: 2, price: limit - 200 },
    });
    expect(Order.parse(modified.json())).toMatchObject({
      qty: 2,
      price: limit - 200,
      status: 'OPEN',
    });
    expect((await funds()).blocked).toBe(2 * (limit - 200));

    const cancel = () =>
      app.inject({ method: 'DELETE', url: `/v1/orders/${placed.id}`, headers: bearer() });
    expect(Order.parse((await cancel()).json()).status).toBe('CANCELLED');
    const again = await cancel();
    expect(again.statusCode).toBe(409);
    expect(ApiError.parse(again.json()).error).toMatchObject({
      code: 'INVALID_ORDER_STATE',
      details: { reason: 'ILLEGAL_TRANSITION', order: { id: placed.id, status: 'CANCELLED' } },
    });
    const summary = await funds();
    expect(summary).toMatchObject({ blocked: 0, available: PAPER_OPENING_BALANCE_PAISE });

    const actions = (await app.deps.repos.audit.list(user.session.user.id))
      .filter((entry) => entry.actor.type === 'user')
      .map((entry) => `${entry.action}:${entry.outcome}`);
    expect(actions).toEqual([
      'ORDER_PLACE:OK',
      'ORDER_MODIFY:OK',
      'ORDER_CANCEL:OK',
      'ORDER_CANCEL:REFUSED',
    ]);
  });

  it('rejects an order the cash cannot cover with 422, and keeps it as REJECTED', async () => {
    const price = await ltp();
    const qty = Math.floor(PAPER_OPENING_BALANCE_PAISE / price) + 1;
    const response = await place({ qty });
    expect(response.statusCode).toBe(422);
    const { error } = ApiError.parse(response.json());
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
    expect(error.message).toMatch(/Not enough cash/);
    const rejected = Order.parse(error.details?.['order']);
    expect(rejected).toMatchObject({ status: 'REJECTED', qty });

    const list = OrdersPage.parse((await get('/v1/orders?status=REJECTED')).json());
    expect(list.items.map((o) => o.id)).toEqual([rejected.id]);
    const audit = await app.deps.repos.audit.list(user.session.user.id);
    expect(audit.at(-1)).toMatchObject({
      action: 'ORDER_PLACE',
      outcome: 'REFUSED',
      detail: { reason: 'INSUFFICIENT_FUNDS', status: 'REJECTED' },
    });
  });

  it("answers 404 for an unknown instrument, an index, and another user's order", async () => {
    const unknown = await place({ token: 999_999 });
    expect(unknown.statusCode).toBe(404);
    const index = master.indices[0]?.instrument.token ?? 0;
    expect((await place({ token: index })).statusCode).toBe(404);

    const mine = Order.parse((await place({})).json());
    const other = await loginWithOtp(app, '9876543211');
    expect((await get(`/v1/orders/${mine.id}`, other)).statusCode).toBe(404);
    const cancel = await app.inject({
      method: 'DELETE',
      url: `/v1/orders/${mine.id}`,
      headers: bearer(other),
    });
    expect(cancel.statusCode).toBe(404);
    expect(OrdersPage.parse((await get('/v1/orders', other)).json()).items).toEqual([]);
  });

  it('needs a session on every route', async () => {
    for (const name of ['ordersList', 'fundsSummary'] as const) {
      const response = await app.inject({ method: 'GET', url: routes[name].path });
      expect(response.statusCode).toBe(401);
    }
    const response = await app.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers: { 'x-csrf-token': 'x' },
      payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1 },
    });
    expect(response.statusCode).toBe(401);
  });

  it('keeps an evening order as AMO and releases it at 9:15 IST on the next sweep', async () => {
    await app.close();
    market.dispose();
    await start(EVENING_UTC);
    const limit = (await ltp()) + 500;
    const amo = Order.parse((await place({ type: 'LIMIT', price: limit })).json());
    expect(amo.status).toBe('AMO');
    const updates: string[] = [];
    app.deps.orders.onOrderUpdate((_userId, order) => updates.push(order.status));

    clock.advance((13 * 60 + 16) * 60_000); // Tuesday 9:16 IST
    await app.deps.orders.sweep();
    expect(updates).toEqual(['OPEN', 'EXECUTED']);
  });
});

describe('order sweep timer', () => {
  it('syncs every account on its interval once the app is ready', async () => {
    const sweepClock = manualClock(MARKET_OPEN_UTC);
    const sweepMarket = new MockMarketDataAdapter({
      master,
      clock: sweepClock,
      scheduler: noTimers,
    });
    const sweepApp = buildApp({
      deps: { clock: sweepClock, market: sweepMarket },
      orderSweepMs: 5,
    });
    let sweeps = 0;
    const original = sweepApp.deps.orders.sweep;
    sweepApp.deps.orders.sweep = () => {
      sweeps += 1;
      return original();
    };
    await sweepApp.ready();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await sweepApp.close();
    sweepMarket.dispose();
    expect(sweeps).toBeGreaterThan(0);
  });
});
