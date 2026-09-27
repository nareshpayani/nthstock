import {
  HoldingsResponse,
  Order,
  OrderHistoryResponse,
  PortfolioSummary,
  PositionsResponse,
  type Instrument,
  type Quote,
} from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { createManualClock, createSequentialIds } from './context.js';
import { orderApiError } from './orderErrors.js';
import { PaperDesk, type DeskMarket } from './paperDesk.js';
import { INFY, TCS, ist } from './testHarness.js';

const NIFTY_TOKEN = 99_001;

const instrument = (token: number, symbol: string, type: Instrument['type']): Instrument => ({
  token,
  symbol,
  exchange: 'NSE',
  name: symbol,
  type,
  isin: type === 'EQUITY' ? 'INE000000001' : null,
  sector: null,
  lotSize: 1,
  tickSize: 5,
});

/** A scripted market: fixed quotes and bands; `tick` pushes a price to subscribers. */
function fakeMarket() {
  const ltps = new Map<string, number>([
    ['INFY', 1_500_00],
    ['TCS', 3_800_00],
  ]);
  const prevCloses = new Map<string, number>([
    ['INFY', 1_480_00],
    ['TCS', 3_750_00],
  ]);
  const bands = new Map([
    ['INFY', INFY],
    ['TCS', TCS],
  ]);
  const tokens = new Map([
    ['INFY', INFY.token],
    ['TCS', TCS.token],
  ]);
  const listeners = new Set<{
    symbols: readonly string[];
    listener: (q: readonly Quote[]) => void;
  }>();
  const calls = { stats: 0, quotes: 0, subscribes: 0 };
  const quoteOf = (symbol: string): Quote => ({
    token: tokens.get(symbol) ?? 0,
    symbol,
    exchange: 'NSE',
    ltp: ltps.get(symbol) ?? 0,
    change: 0,
    changeBp: 0,
    open: 0,
    high: 0,
    low: 0,
    prevClose: prevCloses.get(symbol) ?? 0,
    volume: 0,
    ts: '2026-09-25T04:30:00.000Z',
  });
  const market: DeskMarket & {
    tick(symbol: string, ltp: number): void;
    calls: typeof calls;
    subscribers(): number;
  } = {
    listInstruments: () =>
      Promise.resolve([
        instrument(INFY.token, 'INFY', 'EQUITY'),
        instrument(TCS.token, 'TCS', 'EQUITY'),
        instrument(NIFTY_TOKEN, 'NIFTY', 'INDEX'),
      ]),
    getQuote: (symbol) => {
      calls.quotes += 1;
      return Promise.resolve(ltps.has(symbol) ? quoteOf(symbol) : null);
    },
    getStats: (symbol) => {
      calls.stats += 1;
      return Promise.resolve(bands.get(symbol) ?? null);
    },
    subscribe: (symbols, listener) => {
      calls.subscribes += 1;
      const entry = { symbols, listener };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    tick(symbol, ltp) {
      ltps.set(symbol, ltp);
      for (const { symbols, listener } of listeners) {
        if (symbols.includes(symbol)) listener([quoteOf(symbol)]);
      }
    },
    calls,
    subscribers: () => listeners.size,
  };
  return market;
}

function setup(at = ist(25, 10, 0)) {
  const clock = createManualClock(at);
  const market = fakeMarket();
  const updates: { userId: string; order: Order }[] = [];
  const changes: string[] = [];
  const desk = new PaperDesk({
    clock,
    market,
    newId: createSequentialIds('o'),
    onOrderUpdate: (userId, order) => updates.push({ userId, order: Order.parse(order) }),
    onChange: (userId) => changes.push(userId),
  });
  return { desk, clock, market, updates, changes };
}

const limitBuy = (price: number, qty = 10) =>
  ({ token: INFY.token, side: 'BUY', type: 'LIMIT', product: 'DELIVERY', qty, price }) as const;
const marketBuy = (qty = 10) =>
  ({ token: INFY.token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty }) as const;

describe('PaperDesk', () => {
  it('fills a MARKET order at the adapter LTP and subscribes the instrument once', async () => {
    const { desk, market } = setup();
    const result = await desk.place('u1', marketBuy());
    expect(result).toMatchObject({
      ok: true,
      order: { status: 'EXECUTED', avgFillPrice: 1_500_00 },
    });
    await desk.place('u1', marketBuy(1));
    expect(market.calls.subscribes).toBe(1);
    expect(market.calls.stats).toBe(1);
    expect(desk.ltp(INFY.token)).toBe(1_500_00);
  });

  it('fills a LIMIT order on the tick that crosses it, for its owner only', async () => {
    const { desk, market, updates } = setup();
    const a = await desk.place('alice', limitBuy(1_490_00));
    const b = await desk.place('bob', limitBuy(1_480_00));
    if (!a.ok || !b.ok) throw new Error('place failed');
    expect(a.order.status).toBe('OPEN');
    updates.length = 0;

    market.tick('INFY', 1_495_00);
    expect(updates).toEqual([]);
    market.tick('INFY', 1_485_00);
    expect(updates.map((u) => [u.userId, u.order.id, u.order.status])).toEqual([
      ['alice', a.order.id, 'EXECUTED'],
    ]);
    expect(desk.getOrder('bob', a.order.id)).toBeNull();
    expect(desk.getOrder('bob', b.order.id)?.status).toBe('OPEN');
  });

  it('a pinned price wins over the feed and syncs live orders at once', async () => {
    const { desk, market } = setup();
    const placed = await desk.place('u1', limitBuy(1_490_00));
    if (!placed.ok) throw new Error('place failed');
    desk.pinPrice(INFY.token, 1_490_00);
    expect(desk.getOrder('u1', placed.order.id)?.status).toBe('EXECUTED');

    market.tick('INFY', 1_700_00);
    expect(desk.ltp(INFY.token)).toBe(1_490_00);
    desk.unpinPrice(INFY.token);
    expect(desk.ltp(INFY.token)).toBe(1_700_00);
    expect(() => desk.pinPrice(INFY.token, 0)).toThrow(RangeError);
  });

  it('modify and cancel go to the owner engine; another user gets ORDER_NOT_FOUND', async () => {
    const { desk } = setup();
    const placed = await desk.place('u1', limitBuy(1_400_00));
    if (!placed.ok) throw new Error('place failed');
    const id = placed.order.id;

    expect(await desk.modify('u2', id, { price: 1_410_00 })).toMatchObject({
      ok: false,
      code: 'ORDER_NOT_FOUND',
    });
    expect(await desk.cancel('u2', id)).toMatchObject({ ok: false, code: 'ORDER_NOT_FOUND' });
    expect(await desk.modify('u1', id, { price: 1_410_00 })).toMatchObject({
      ok: true,
      order: { price: 1_410_00, status: 'OPEN' },
    });
    expect(await desk.cancel('u1', id)).toMatchObject({ ok: true, order: { status: 'CANCELLED' } });
    expect(await desk.cancel('u1', id)).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(desk.fundsSummary('u1').blocked).toBe(0);
  });

  it('refuses an index or an unknown token as UNKNOWN_INSTRUMENT', async () => {
    const { desk } = setup();
    expect(await desk.place('u1', { ...marketBuy(), token: NIFTY_TOKEN })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_INSTRUMENT',
    });
    expect(await desk.place('u1', { ...marketBuy(), token: 424_242 })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_INSTRUMENT',
    });
  });

  it('pages orders newest first by status, with a cursor', async () => {
    const { desk } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const placed = await desk.place('u1', limitBuy(1_400_00 + i * 5, 1));
      if (placed.ok) ids.push(placed.order.id);
    }
    await desk.place('u1', marketBuy(1));
    const first = desk.ordersPage('u1', { status: 'OPEN', limit: 2 });
    expect(first?.items.map((o) => o.id)).toEqual([ids[4], ids[3]]);
    const second = desk.ordersPage('u1', {
      status: 'OPEN',
      limit: 2,
      cursor: first?.nextCursor ?? '',
    });
    expect(second?.items.map((o) => o.id)).toEqual([ids[2], ids[1]]);
    const third = desk.ordersPage('u1', {
      status: 'OPEN',
      limit: 2,
      cursor: second?.nextCursor ?? '',
    });
    expect(third).toEqual({ items: [expect.objectContaining({ id: ids[0] })], nextCursor: null });
    expect(desk.ordersPage('u1')?.items).toHaveLength(6);
    expect(desk.ordersPage('u1', { cursor: 'nope' })).toBeNull();
  });

  it('sweep() releases AMOs at 9:15 IST without a tick or a request', async () => {
    const { desk, clock, updates } = setup(ist(24, 20, 0));
    const placed = await desk.place('u1', limitBuy(1_600_00));
    if (!placed.ok) throw new Error('place failed');
    expect(placed.order.status).toBe('AMO');
    updates.length = 0;

    clock.set(ist(25, 9, 16));
    await desk.sweep();
    expect(updates.map((u) => u.order.status)).toEqual(['OPEN', 'EXECUTED']);
  });

  it('restores a user from a snapshot and keeps feeding their live orders', async () => {
    const first = setup();
    const placed = await first.desk.place('u1', limitBuy(1_490_00));
    if (!placed.ok) throw new Error('place failed');
    const snapshot = first.desk.engineOf('u1').snapshot();

    const second = setup();
    await second.desk.restore('u1', JSON.parse(JSON.stringify(snapshot)) as typeof snapshot);
    expect(second.market.calls.subscribes).toBe(1);
    second.market.tick('INFY', 1_480_00);
    expect(second.updates.map((u) => [u.userId, u.order.id, u.order.status])).toEqual([
      ['u1', placed.order.id, 'EXECUTED'],
    ]);
    expect(second.changes).toContain('u1');
  });

  it('refreshes instrument data on a new IST day and stops feeding after dispose', async () => {
    const { desk, clock, market, updates } = setup();
    await desk.place('u1', limitBuy(1_400_00));
    clock.set(ist(28, 10, 0));
    await desk.place('u1', limitBuy(1_400_00));
    expect(market.calls.stats).toBe(2);

    desk.dispose();
    expect(market.subscribers()).toBe(0);
    updates.length = 0;
    const quote = await market.getQuote('INFY');
    if (!quote) throw new Error('no quote');
    desk.ingest([{ ...quote, ltp: 1_300_00 }]);
    expect(updates).toEqual([]);
  });
});

describe('orderApiError', () => {
  it('maps engine codes to the HTTP status and ApiError code both backends answer with', () => {
    const order = null;
    expect(orderApiError({ ok: false, code: 'INSUFFICIENT_FUNDS', reason: 'r', order })).toEqual({
      status: 422,
      code: 'INSUFFICIENT_FUNDS',
      message: 'r',
      details: { reason: 'INSUFFICIENT_FUNDS' },
    });
    expect(orderApiError({ ok: false, code: 'ORDER_NOT_FOUND', reason: 'r', order }).status).toBe(
      404,
    );
    expect(orderApiError({ ok: false, code: 'ILLEGAL_TRANSITION', reason: 'r', order }).code).toBe(
      'INVALID_ORDER_STATE',
    );
    expect(
      orderApiError({ ok: false, code: 'INTRADAY_MARKET_CLOSED', reason: 'r', order }).code,
    ).toBe('MARKET_CLOSED');
  });

  it('keeps the history of each order with every change, for its owner only', async () => {
    const { desk, clock } = setup();
    const placed = await desk.place('u1', limitBuy(1_450_00));
    if (!placed.ok) throw new Error('place failed');
    clock.advance(60_000);
    await desk.modify('u1', placed.order.id, { price: 1_460_00, qty: 12 });
    clock.advance(60_000);
    await desk.cancel('u1', placed.order.id);

    const history = OrderHistoryResponse.parse(desk.orderHistory('u1', placed.order.id));
    expect(history.items.map((e) => [e.event, e.status, e.at, e.qty, e.price])).toEqual([
      ['PLACED', 'OPEN', ist(25, 10, 0).toISOString(), 10, 1_450_00],
      ['MODIFIED', 'OPEN', ist(25, 10, 1).toISOString(), 12, 1_460_00],
      ['CANCELLED', 'CANCELLED', ist(25, 10, 2).toISOString(), 12, 1_460_00],
    ]);
    expect(history.items[2]?.note).toBe('Cancelled by you.');
    expect(desk.orderHistory('u2', placed.order.id)).toBeNull();
  });

  it('values positions at the LTP the engines see, marking them to each new tick', async () => {
    const { desk, market } = setup();
    await desk.place('u1', marketBuy(10));
    await desk.place('u1', {
      token: TCS.token,
      side: 'SELL',
      type: 'MARKET',
      product: 'INTRADAY',
      qty: 2,
    });
    let positions = PositionsResponse.parse({ items: await desk.positions('u1') }).items;
    expect(positions.map((p) => [p.symbol, p.product, p.netQty, p.ltp, p.unrealisedPnl])).toEqual([
      ['INFY', 'DELIVERY', 10, 1_500_00, 0],
      ['TCS', 'INTRADAY', -2, 3_800_00, 0],
    ]);

    market.tick('INFY', 1_510_00);
    positions = await desk.positions('u1');
    expect(positions[0]).toMatchObject({ ltp: 1_510_00, unrealisedPnl: 10 * 10_00 });
    expect(positions[1]).toMatchObject({ ltp: 3_800_00, unrealisedPnl: 0 });
    expect(await desk.positions('u2')).toEqual([]);
  });

  it('carries delivery buys into holdings at the close, valued against the previous close', async () => {
    const { desk, clock } = setup();
    await desk.place('u1', marketBuy(10));
    expect(await desk.holdings('u1')).toEqual([]);

    clock.set(ist(28, 10, 0));
    desk.pinPrice(INFY.token, 1_520_00);
    const holdings = HoldingsResponse.parse({ items: await desk.holdings('u1') }).items;
    expect(holdings).toEqual([
      {
        token: INFY.token,
        symbol: 'INFY',
        exchange: 'NSE',
        qty: 10,
        avgPrice: 1_500_00,
        ltp: 1_520_00,
        investedValue: 15_000_00,
        currentValue: 15_200_00,
        pnl: 200_00,
        pnlBp: 133,
        dayChange: 10 * (1_520_00 - 1_480_00),
        dayChangeBp: 270,
      },
    ]);

    const summary = PortfolioSummary.parse(await desk.portfolioSummary('u1'));
    expect(summary).toEqual({
      investedValue: 15_000_00,
      currentValue: 15_200_00,
      totalPnl: 200_00,
      totalPnlBp: 133,
      dayPnl: 400_00,
      dayPnlBp: 270,
      holdingsCount: 1,
      positionsCount: 0,
      asOf: ist(28, 10, 0).toISOString(),
    });
  });
});
