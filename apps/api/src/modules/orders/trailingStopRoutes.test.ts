import {
  AccountState,
  ApiError,
  Order,
  TrailingStop,
  TrailingStopsResponse,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp, type LoggedIn } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';

// Server-side trailing stops (NSTOCK-0368, SPEC-TFC-1 §6 and §10.6): the routes run the same
// engine rules as the MSW mock, and every action is audited.

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const MARKET_OPEN_UTC = '2026-09-28T04:30:00.000Z';

const master = generateSymbolMaster({ equityCount: 20 });
const equity = master.equities[0]?.instrument;
if (!equity) throw new Error('no equity in the test master');
const TOKEN = equity.token;
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let app: App;
let market: MockMarketDataAdapter;
let user: LoggedIn;

beforeEach(async () => {
  const clock = manualClock(MARKET_OPEN_UTC);
  market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  app = buildApp({ deps: { clock, market }, orderSweepMs: null });
  user = await loginWithOtp(app, '9876543210');
});

afterEach(async () => {
  await app.close();
  market.dispose();
});

const headers = () => ({ authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' });

const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: headers(), ...(payload ? { payload } : {}) });

/** Buys 10 at the LTP and answers the fill price. */
async function buy(): Promise<number> {
  const response = await send('POST', routes.orderPlace.path, {
    token: TOKEN,
    side: 'BUY',
    type: 'MARKET',
    product: 'DELIVERY',
    qty: 10,
  });
  expect(response.statusCode, response.body).toBe(200);
  return Order.parse(response.json()).avgFillPrice ?? 0;
}

/** One scripted tick at `price`, run through the desk like the feed's. */
async function tick(price: number) {
  app.deps.orders.pinPrice(TOKEN, price);
  await app.deps.orders.sweep();
}

const stopRequest = {
  token: TOKEN,
  product: 'DELIVERY',
  trail: { unit: 'AMOUNT', amount: 10_00 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
};

describe('trailing-stop routes (NSTOCK-0368)', () => {
  it('sets a stop, ratchets it with ticks, triggers it and closes the position', async () => {
    const bought = await buy();
    const placed = await send('POST', routes.trailingStopPlace.path, stopRequest);
    expect(placed.statusCode, placed.body).toBe(200);
    const stop = TrailingStop.parse(placed.json());
    expect(stop).toMatchObject({ status: 'TRAILING', stopPrice: bought - 10_00, protectedQty: 10 });

    await tick(bought + 20_00);
    const listed = TrailingStopsResponse.parse((await send('GET', '/v1/trailing-stops')).json());
    expect(listed.items[0]).toMatchObject({ id: stop.id, stopPrice: bought + 10_00 });
    // Down again: the stop never loosens.
    await tick(bought + 15_00);
    const state = AccountState.parse((await send('GET', routes.accountState.path)).json());
    expect(state.trailingStops[0]).toMatchObject({ stopPrice: bought + 10_00 });
    expect(state.seq).toBe(state.trailingStops[0]?.seq);

    await tick(bought + 9_00);
    const done = AccountState.parse((await send('GET', routes.accountState.path)).json());
    expect(done.trailingStops[0]).toMatchObject({ status: 'EXECUTED' });
    const exit = done.orders.find((order) => order.id === done.trailingStops[0]?.exitOrderId);
    expect(exit).toMatchObject({ side: 'SELL', qty: 10, status: 'EXECUTED' });
    expect(done.positions.find((p) => p.token === TOKEN)?.netQty).toBe(0);

    const actions = (await app.deps.repos.audit.list(user.session.user.id)).map((e) => e.action);
    expect(actions).toContain('TRAILING_STOP_PLACE');
    expect(actions.filter((action) => action === 'TRAILING_STOP_UPDATE').length).toBeGreaterThan(1);
  });

  it('modifies and cancels a stop', async () => {
    const bought = await buy();
    const stop = TrailingStop.parse(
      (await send('POST', routes.trailingStopPlace.path, stopRequest)).json(),
    );
    const modified = await send('PATCH', `/v1/trailing-stops/${stop.id}`, {
      trail: { unit: 'AMOUNT', amount: 25_00 },
    });
    expect(modified.statusCode, modified.body).toBe(200);
    expect(TrailingStop.parse(modified.json()).stopPrice).toBe(bought - 25_00);

    const cancelled = await send('DELETE', `/v1/trailing-stops/${stop.id}`);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(TrailingStop.parse(cancelled.json()).status).toBe('CANCELLED');
    const actions = (await app.deps.repos.audit.list(user.session.user.id)).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['TRAILING_STOP_MODIFY', 'TRAILING_STOP_CANCEL']),
    );
  });

  it('refuses a stop without a position, another user’s stop, and bad or unsigned requests', async () => {
    const refused = await send('POST', routes.trailingStopPlace.path, stopRequest);
    expect(refused.statusCode).toBe(422);
    expect(ApiError.parse(refused.json()).error.code).toBe('ORDER_REJECTED');

    await buy();
    const mine = TrailingStop.parse(
      (await send('POST', routes.trailingStopPlace.path, stopRequest)).json(),
    );
    const other = await loginWithOtp(app, '9876543211');
    const theirs = await app.inject({
      method: 'DELETE',
      url: `/v1/trailing-stops/${mine.id}`,
      headers: { authorization: `Bearer ${other.access}`, 'x-csrf-token': 'bearer' },
    });
    expect(theirs.statusCode).toBe(404);
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/trailing-stops',
      headers: { authorization: `Bearer ${other.access}` },
    });
    expect(TrailingStopsResponse.parse(listed.json()).items).toEqual([]);

    expect((await app.inject({ method: 'GET', url: '/v1/trailing-stops' })).statusCode).toBe(401);
    const unsigned = await app.inject({
      method: 'POST',
      url: routes.trailingStopPlace.path,
      headers: { authorization: `Bearer ${user.access}` },
      payload: stopRequest,
    });
    expect(unsigned.statusCode).toBe(403);
    const invalid = await send('POST', routes.trailingStopPlace.path, {
      ...stopRequest,
      trail: { unit: 'AMOUNT', amount: -1 },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('answers a retried place with the same stop (idempotency key)', async () => {
    await buy();
    const request = { ...stopRequest, clientRequestId: 'ts_retry_1' };
    const first = TrailingStop.parse(
      (await send('POST', routes.trailingStopPlace.path, request)).json(),
    );
    const again = TrailingStop.parse(
      (await send('POST', routes.trailingStopPlace.path, request)).json(),
    );
    expect(again.id).toBe(first.id);
  });

  it('closes a position in one step, cancelling its stop', async () => {
    await buy();
    const stop = TrailingStop.parse(
      (await send('POST', routes.trailingStopPlace.path, stopRequest)).json(),
    );
    const closed = await send('POST', routes.positionClose.path, {
      token: TOKEN,
      product: 'DELIVERY',
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(Order.parse(closed.json())).toMatchObject({ side: 'SELL', qty: 10 });
    const listed = TrailingStopsResponse.parse((await send('GET', '/v1/trailing-stops')).json());
    expect(listed.items.find((item) => item.id === stop.id)?.status).toBe('CANCELLED');
  });

  it('announces each committed change as an account delta at its seq', async () => {
    const deltas: { seq: number; stops: string[] }[] = [];
    app.deps.orders.onAccountDelta((_userId, delta) =>
      deltas.push({ seq: delta.seq, stops: delta.trailingStops.map((s) => s.status) }),
    );
    const bought = await buy();
    await send('POST', routes.trailingStopPlace.path, stopRequest);
    await tick(bought + 20_00);
    expect(deltas.map((delta) => delta.stops)).toEqual([[], ['TRAILING'], ['TRAILING']]);
    expect(deltas.map((delta) => delta.seq)).toEqual(
      [...deltas.map((delta) => delta.seq)].sort((a, b) => a - b),
    );
  });
});
