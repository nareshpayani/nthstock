import {
  ApiError,
  NotificationsResponse,
  PriceAlert,
  PriceAlertsResponse,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp, type LoggedIn } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const MARKET_OPEN_UTC = '2026-09-28T04:30:00.000Z';

const master = generateSymbolMaster({ equityCount: 60 });
const equity = master.equities[0]?.instrument;
if (!equity) throw new Error('no equity in the test master');
const SYMBOL = equity.symbol;

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

const bearer = (who: LoggedIn = user) => ({
  authorization: `Bearer ${who.access}`,
  'x-csrf-token': 'bearer',
});

async function ltp() {
  const quote = await market.getQuote(SYMBOL);
  if (!quote) throw new Error('no quote');
  return quote.ltp;
}

describe('price alert routes (NSTOCK-0344)', () => {
  it('creates, lists and cancels an alert; another user sees none of it', async () => {
    const level = (await ltp()) - ((await ltp()) % 5) + 10_000;
    const created = await app.inject({
      method: 'POST',
      url: routes.priceAlertCreate.path,
      headers: bearer(),
      payload: { symbol: SYMBOL, condition: 'ABOVE', price: level },
    });
    expect(created.statusCode).toBe(200);
    const alert = PriceAlert.parse(created.json());
    expect(alert).toMatchObject({ symbol: SYMBOL, status: 'ACTIVE', price: level });

    const listed = await app.inject({ method: 'GET', url: '/v1/alerts', headers: bearer() });
    expect(PriceAlertsResponse.parse(listed.json()).items.map((a) => a.id)).toEqual([alert.id]);

    const other = await loginWithOtp(app, '9876543211');
    const theirs = await app.inject({
      method: 'DELETE',
      url: `/v1/alerts/${alert.id}`,
      headers: bearer(other),
    });
    expect(theirs.statusCode).toBe(404);

    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/v1/alerts/${alert.id}`,
      headers: bearer(),
    });
    expect(PriceAlert.parse(cancelled.json()).status).toBe('CANCELLED');
    const again = await app.inject({
      method: 'DELETE',
      url: `/v1/alerts/${alert.id}`,
      headers: bearer(),
    });
    expect(again.statusCode).toBe(409);
    expect(ApiError.parse(again.json()).error.code).toBe('CONFLICT');
  });

  it('refuses a level the price has already passed, and needs a session', async () => {
    const below = await app.inject({
      method: 'POST',
      url: routes.priceAlertCreate.path,
      headers: bearer(),
      payload: { symbol: SYMBOL, condition: 'ABOVE', price: 5 },
    });
    expect(below.statusCode).toBe(400);
    expect(ApiError.parse(below.json()).error.code).toBe('VALIDATION_ERROR');
    const anonymous = await app.inject({ method: 'GET', url: '/v1/notifications' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('notifies an executed order and marks it read', async () => {
    await app.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers: bearer(),
      payload: { token: equity?.token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 3 },
    });
    const list = NotificationsResponse.parse(
      (await app.inject({ method: 'GET', url: '/v1/notifications', headers: bearer() })).json(),
    );
    // The sign-in raised a SECURITY notification before the fill (NSTOCK-0382).
    expect(list.items.map((item) => item.kind)).toEqual(['ORDER_FILLED', 'SECURITY']);
    expect(list.unread).toBe(2);
    expect(list.items[0]).toMatchObject({ kind: 'ORDER_FILLED', title: 'Order executed' });
    const read = await app.inject({
      method: 'POST',
      url: routes.notificationsMarkRead.path,
      headers: bearer(),
      payload: {},
    });
    expect(NotificationsResponse.parse(read.json()).unread).toBe(0);
  });
});
