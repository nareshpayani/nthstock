import {
  ApiError,
  Order,
  TEST_CONTROL_PATHS,
  TestClockResponse,
  TestPriceResponse,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { offsetClock } from './offsetClock.js';

/** Monday 28 Sep 2026, 20:00 IST: closed, so a buy waits as AMO. */
const MONDAY_20_00_IST = '2026-09-28T14:30:00.000Z';
/** Tuesday 29 Sep 2026, 9:16 IST: after the 9:15 AMO release. */
const TUESDAY_09_16_IST = '2026-09-29T03:46:00.000Z';

const master = generateSymbolMaster({ equityCount: 20 });
const equity = master.equities[0]?.instrument;
if (!equity) throw new Error('no equity in the test master');
const SYMBOL = equity.symbol;
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };
const csrf = { 'x-csrf-token': 'e2e' };

let app: App | null = null;
let market: MockMarketDataAdapter | null = null;

function start(options: { controls: boolean; production?: boolean }) {
  const clock = offsetClock();
  const adapter = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  market = adapter;
  app = buildApp({
    deps: {
      clock,
      market: adapter,
      production: options.production ?? false,
      jwtSecret: new TextEncoder().encode('test-only-secret-at-least-32-characters'),
    },
    orderSweepMs: null,
    ...(options.controls ? { testControls: { setTime: clock.set } } : {}),
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  market?.dispose();
  app = null;
  market = null;
});

/** The equity's previous close on the 5-paise tick, and about 2% under it. */
async function prices() {
  const stats = await market?.getStats(SYMBOL);
  if (!stats) throw new Error('no stats');
  const base = Math.round(stats.prevClose / 5) * 5;
  return { base, below: Math.floor((base * 0.98) / 5) * 5 };
}

const post = (target: App, url: string, payload: object) =>
  target.inject({ method: 'POST', url, headers: csrf, payload });

describe('/v1/__test routes (T-162)', () => {
  it('404 when the app is built without test controls (every normal and production start)', async () => {
    const plain = start({ controls: false });
    for (const path of Object.values(TEST_CONTROL_PATHS)) {
      const response = await post(plain, path, { at: MONDAY_20_00_IST, symbol: 'X', ltp: 5 });
      expect(response.statusCode, path).toBe(404);
    }
  });

  it('refuse to build in production', () => {
    expect(() => start({ controls: true, production: true })).toThrow(/cannot be enabled/);
  });

  it('set the clock, and a jump past 9:15 releases an AMO at once', async () => {
    const target = start({ controls: true });
    const set = await post(target, TEST_CONTROL_PATHS.clock, { at: MONDAY_20_00_IST });
    expect(set.statusCode).toBe(200);
    expect(Date.parse(TestClockResponse.parse(set.json()).now)).toBeGreaterThanOrEqual(
      Date.parse(MONDAY_20_00_IST),
    );
    const health = await target.inject({ method: 'GET', url: routes.health.path });
    expect((health.json() as { time: string }).time.slice(0, 13)).toBe('2026-09-28T14');

    const pinned = await post(target, TEST_CONTROL_PATHS.price, {
      symbol: equity.symbol,
      ltp: 100_000,
    });
    expect(TestPriceResponse.parse(pinned.json())).toEqual({
      symbol: equity.symbol,
      token: equity.token,
      ltp: 100_000,
    });

    const user = await loginWithOtp(target, '9876500042');
    const auth = { authorization: `Bearer ${user.access}`, ...csrf };
    const placed = await target.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers: auth,
      payload: { token: equity.token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 2 },
    });
    const amo = Order.parse(placed.json());
    expect(amo.status).toBe('AMO');

    // The sweep runs with the jump, so no request or tick is needed for the release.
    await post(target, TEST_CONTROL_PATHS.clock, { at: TUESDAY_09_16_IST });
    const fresh = await loginWithOtp(target, '9876500042');
    const got = await target.inject({
      method: 'GET',
      url: routes.orderGet.path.replace(':id', amo.id),
      headers: { authorization: `Bearer ${fresh.access}` },
    });
    expect(Order.parse(got.json())).toMatchObject({
      status: 'EXECUTED',
      filledQty: 2,
      avgFillPrice: 100_000,
    });
  });

  it('a scripted price fills a resting limit order that it crosses', async () => {
    const target = start({ controls: true });
    await post(target, TEST_CONTROL_PATHS.clock, { at: '2026-09-28T04:30:00.000Z' });
    const { base, below } = await prices();
    await post(target, TEST_CONTROL_PATHS.price, { symbol: equity.symbol, ltp: base });
    const user = await loginWithOtp(target, '9876500043');
    const auth = { authorization: `Bearer ${user.access}`, ...csrf };
    const placed = await target.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers: auth,
      payload: {
        token: equity.token,
        side: 'BUY',
        type: 'LIMIT',
        price: below,
        product: 'DELIVERY',
        qty: 1,
      },
    });
    const order = Order.parse(placed.json());
    expect(order.status).toBe('OPEN');
    await post(target, TEST_CONTROL_PATHS.price, { symbol: equity.symbol, ltp: below - 5 });
    const got = await target.inject({
      method: 'GET',
      url: routes.orderGet.path.replace(':id', order.id),
      headers: auth,
    });
    expect(Order.parse(got.json())).toMatchObject({ status: 'EXECUTED', avgFillPrice: below });
  });

  it('reject a bad body (400) and an unknown symbol (404)', async () => {
    const target = start({ controls: true });
    const bad = await post(target, TEST_CONTROL_PATHS.clock, { at: 'tomorrow' });
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error.code).toBe('VALIDATION_ERROR');
    const price = await post(target, TEST_CONTROL_PATHS.price, { symbol: 'INFY', ltp: -1 });
    expect(price.statusCode).toBe(400);
    const unknown = await post(target, TEST_CONTROL_PATHS.price, { symbol: 'NOPE', ltp: 100 });
    expect(unknown.statusCode).toBe(404);
    expect(ApiError.parse(unknown.json()).error.code).toBe('NOT_FOUND');
  });
});
