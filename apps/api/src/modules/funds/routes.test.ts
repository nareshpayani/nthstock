import {
  AUTH_COOKIES,
  ApiError,
  FundsSummary,
  LedgerPage,
  Order,
  PAPER_OPENING_BALANCE_PAISE,
  PositionsResponse,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { cookieHeader, csrfHeader, loginWithOtp, type LoggedIn } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const MONDAY_10_00_IST = '2026-09-28T04:30:00.000Z';

const master = generateSymbolMaster({ equityCount: 60 });
const equity = master.equities[0]?.instrument;
if (!equity) throw new Error('no equity in the test master');
const TOKEN = equity.token;
const PRICE = 1_500_00;

/** Ticks only when the test calls `market.tick()`. */
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let app: App;
let market: MockMarketDataAdapter;
let user: LoggedIn;

beforeEach(async () => {
  const clock = manualClock(MONDAY_10_00_IST);
  market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  app = buildApp({ deps: { clock, market }, orderSweepMs: null });
  user = await loginWithOtp(app, '9876500011');
  app.deps.orders.pinPrice(TOKEN, PRICE);
});

afterEach(async () => {
  await app.close();
  market.dispose();
});

const bearer = (who: LoggedIn = user) => ({
  authorization: `Bearer ${who.access}`,
  'x-csrf-token': 'bearer',
});

const get = (url: string, who: LoggedIn = user) =>
  app.inject({ method: 'GET', url, headers: bearer(who) });

const place = async (payload: Record<string, unknown>) =>
  Order.parse(
    (
      await app.inject({
        method: 'POST',
        url: routes.orderPlace.path,
        headers: bearer(),
        payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', ...payload },
      })
    ).json(),
  );

const reset = (payload: unknown, headers: Record<string, string> = bearer()) =>
  app.inject({ method: 'POST', url: routes.fundsReset.path, headers, payload: payload as object });

describe('funds routes (T-155)', () => {
  it('need a session', async () => {
    for (const path of [routes.fundsSummary.path, routes.fundsLedger.path]) {
      const response = await app.inject({ method: 'GET', url: path });
      expect(response.statusCode, path).toBe(401);
      expect(ApiError.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    }
    const anonymous = await reset({ confirm: 'RESET' }, { 'x-csrf-token': 'x' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('page the ledger newest first with a cursor, and refuse an unknown cursor', async () => {
    await place({ qty: 10 });
    await place({ qty: 2 });
    const first = LedgerPage.parse((await get(`${routes.fundsLedger.path}?limit=3`)).json());
    expect(first.items.map((e) => [e.type, e.amount])).toEqual([
      ['TRADE_DEBIT', -2 * PRICE],
      ['ORDER_RELEASE', 2 * PRICE],
      ['ORDER_BLOCK', -2 * PRICE],
    ]);
    expect(first.items[0]?.balanceAfter).toBe(PAPER_OPENING_BALANCE_PAISE - 12 * PRICE);
    const rest = LedgerPage.parse(
      (await get(`${routes.fundsLedger.path}?cursor=${first.nextCursor ?? ''}`)).json(),
    );
    expect(rest.items.map((e) => e.type)).toEqual([
      'TRADE_DEBIT',
      'ORDER_RELEASE',
      'ORDER_BLOCK',
      'OPENING_CREDIT',
    ]);
    expect(rest.nextCursor).toBeNull();

    const bad = await get(`${routes.fundsLedger.path}?cursor=nope`);
    expect(bad.statusCode).toBe(400);
    expect((await get(`${routes.fundsLedger.path}?limit=0`)).statusCode).toBe(400);
  });

  it('reset restores ₹10,00,000.00, writes a RESET entry and clears orders and positions', async () => {
    await place({ qty: 10 });
    const resting = await place({ qty: 5, type: 'LIMIT', price: PRICE - 100_00 });
    expect(resting.status).toBe('OPEN');

    const response = await reset({ confirm: 'RESET' });
    expect(response.statusCode).toBe(200);
    const funds = FundsSummary.parse(response.json());
    expect(funds).toMatchObject({
      openingBalance: PAPER_OPENING_BALANCE_PAISE,
      balance: PAPER_OPENING_BALANCE_PAISE,
      available: PAPER_OPENING_BALANCE_PAISE,
      blocked: 0,
    });
    const [latest] = LedgerPage.parse((await get(routes.fundsLedger.path)).json()).items;
    expect(latest).toMatchObject({
      type: 'RESET',
      amount: 10 * PRICE,
      balanceAfter: PAPER_OPENING_BALANCE_PAISE,
    });
    expect((await get(routes.ordersList.path)).json()).toMatchObject({ items: [] });
    expect(PositionsResponse.parse((await get(routes.positionsList.path)).json()).items).toEqual(
      [],
    );

    // Audited: the reset itself, the cancelled order and every fund movement.
    const audit = await app.deps.repos.audit.list(user.session.user.id);
    expect(audit.filter((e) => e.action === 'FUNDS_RESET')).toEqual([
      expect.objectContaining({
        actor: { type: 'user', userId: user.session.user.id },
        outcome: 'OK',
        detail: expect.objectContaining({ available: PAPER_OPENING_BALANCE_PAISE }),
      }),
    ]);
    expect(
      audit.some(
        (e) =>
          e.action === 'ORDER_UPDATE' &&
          e.orderId === resting.id &&
          e.detail['status'] === 'CANCELLED',
      ),
    ).toBe(true);
    const movements = audit
      .filter((e) => e.action === 'FUNDS_MOVEMENT')
      .map((e) => e.detail['type']);
    expect(movements).toEqual([
      'OPENING_CREDIT',
      'ORDER_BLOCK',
      'ORDER_RELEASE',
      'TRADE_DEBIT',
      'ORDER_BLOCK',
      'ORDER_RELEASE',
      'RESET',
    ]);
  });

  it('reset needs RESET typed exactly and the session CSRF token', async () => {
    for (const body of [{}, { confirm: 'reset' }, { confirm: 'RESET!' }]) {
      const response = await reset(body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(ApiError.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    const cookies = cookieHeader({ [AUTH_COOKIES.access]: user.access });
    const withCookie = await app.inject({
      method: 'POST',
      url: routes.fundsReset.path,
      headers: { cookie: cookies },
      payload: { confirm: 'RESET' },
    });
    expect(withCookie.statusCode).toBe(403);
    const wrongCsrf = await app.inject({
      method: 'POST',
      url: routes.fundsReset.path,
      headers: { cookie: cookies, ...csrfHeader('not-the-token') },
      payload: { confirm: 'RESET' },
    });
    expect(wrongCsrf.statusCode).toBe(403);
    // Nothing was reset.
    const [latest] = LedgerPage.parse((await get(routes.fundsLedger.path)).json()).items;
    expect(latest?.type).toBe('OPENING_CREDIT');
  });

  it('reset leaves another user’s account alone', async () => {
    await place({ qty: 3 });
    const other = await loginWithOtp(app, '9876500012');
    expect((await reset({ confirm: 'RESET' }, bearer(other))).statusCode).toBe(200);
    const mine = FundsSummary.parse((await get(routes.fundsSummary.path)).json());
    expect(mine.available).toBe(PAPER_OPENING_BALANCE_PAISE - 3 * PRICE);
  });
});
