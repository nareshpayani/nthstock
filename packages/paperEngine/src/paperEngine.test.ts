import { Order, type ModifyOrderRequest, type OrderStatus } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { illegalTransitionReason, type OrderEvent } from './orderStateMachine.js';
import { INFY, TCS, createHarness, ist, marketOrder, order } from './testHarness.js';

const OPENING = 10_00_000_00;

describe('PaperEngine.place (T-127, T-128)', () => {
  it('executes a MARKET BUY at LTP at once and settles the cash', () => {
    const { engine, updates } = createHarness();
    const result = engine.place(marketOrder());
    expect(result).toMatchObject({
      ok: true,
      order: {
        status: 'EXECUTED',
        symbol: 'INFY',
        exchange: 'NSE',
        filledQty: 10,
        avgFillPrice: 1_500_00,
        price: null,
        statusReason: null,
      },
    });
    expect(updates.map((o) => o.status)).toEqual(['OPEN', 'EXECUTED']);
    expect(engine.fundsSummary()).toMatchObject({
      available: OPENING - 15_000_00,
      blocked: 0,
      balance: OPENING - 15_000_00,
    });
    expect(engine.ledger.entries().map((e) => e.type)).toEqual([
      'OPENING_CREDIT',
      'ORDER_BLOCK',
      'ORDER_RELEASE',
      'TRADE_DEBIT',
    ]);
    expect(engine.positions()).toEqual([
      {
        token: INFY.token,
        symbol: 'INFY',
        exchange: 'NSE',
        product: 'DELIVERY',
        book: expect.objectContaining({ netQty: 10, openCost: 15_000_00, buyQty: 10 }),
      },
    ]);
  });

  it('opens a LIMIT BUY below LTP, blocks qty × limit, and fills when the price crosses', () => {
    const { engine, prices } = createHarness();
    const placed = engine.place(order({ price: 1_490_00 }));
    expect(placed).toMatchObject({ ok: true, order: { status: 'OPEN', price: 1_490_00 } });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 14_900_00 });

    prices.set(INFY.token, 1_495_00);
    expect(engine.sync()).toEqual([]);
    prices.set(INFY.token, 1_489_00);
    const changed = engine.sync();
    expect(changed).toMatchObject([{ status: 'EXECUTED', avgFillPrice: 1_490_00, filledQty: 10 }]);
    expect(engine.fundsSummary()).toMatchObject({
      blocked: 0,
      available: OPENING - 14_900_00,
    });
  });

  it('stores a risk failure as REJECTED with the plain-language reason and blocks nothing', () => {
    const { engine, updates } = createHarness({ funds: { openingBalance: 1_000_00 } });
    const result = engine.place(order());
    expect(result).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_FUNDS',
      reason: expect.stringMatching(/^Not enough cash/),
      order: { status: 'REJECTED', statusReason: expect.stringMatching(/^Not enough cash/) },
    });
    expect(engine.orders('REJECTED')).toHaveLength(1);
    expect(updates.map((o) => o.status)).toEqual(['REJECTED']);
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: 1_000_00 });
  });

  it('stores nothing for a malformed request', () => {
    const { engine, updates } = createHarness();
    expect(engine.place(order({ price: 1_490_03 }))).toMatchObject({
      ok: false,
      code: 'PRICE_OFF_TICK',
      order: null,
    });
    expect(engine.place(order({ token: 42 }))).toMatchObject({
      ok: false,
      code: 'UNKNOWN_INSTRUMENT',
      order: null,
    });
    expect(engine.orders()).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('returns the same order for a retried clientOrderId', () => {
    const { engine } = createHarness();
    const first = engine.place(order({ clientOrderId: 'c-1' }));
    const again = engine.place(order({ clientOrderId: 'c-1', qty: 99 }));
    expect(again).toEqual(first);
    expect(engine.orders()).toHaveLength(1);

    const rejected = engine.place(order({ clientOrderId: 'c-2', side: 'SELL' }));
    expect(engine.place(order({ clientOrderId: 'c-2', side: 'SELL' }))).toEqual(rejected);
    expect(rejected).toMatchObject({ ok: false, code: 'INSUFFICIENT_HOLDINGS' });
  });

  it('sells for delivery from today’s buys first, then from holdings at their average cost', () => {
    const { engine } = createHarness({
      holdings: [[INFY.token, { qty: 5, investedValue: 6_000_00 }]],
    });
    engine.place(marketOrder({ qty: 3 })); // bought today at ₹1,500
    const sell = engine.place(marketOrder({ side: 'SELL', qty: 6 }));
    expect(sell).toMatchObject({ ok: true, order: { status: 'EXECUTED', avgFillPrice: 1_500_00 } });

    // 3 close today's buys flat (no P&L); 3 come out of holdings bought at ₹1,200.
    expect(engine.positions()[0]?.book).toMatchObject({ netQty: 0, realisedPnl: 0 });
    expect(engine.holdings()).toEqual([
      { token: INFY.token, lot: { qty: 2, investedValue: 2_400_00 } },
    ]);
    expect(engine.holdingSales()).toEqual([
      { token: INFY.token, qty: 3, proceeds: 4_500_00, realisedPnl: 900_00 },
    ]);
    expect(engine.realisedPnlToday()).toBe(900_00);
    expect(engine.fundsSummary().realisedPnlToday).toBe(900_00);

    expect(engine.place(marketOrder({ side: 'SELL', qty: 3 }))).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_HOLDINGS',
      reason: 'You can sell up to 2 INFY shares for delivery; this order is for 3.',
    });
    engine.place(marketOrder({ side: 'SELL', qty: 2 }));
    expect(engine.holdings()).toEqual([]);
  });

  it('counts pending delivery SELL orders against what can still be sold', () => {
    const { engine } = createHarness({
      holdings: [[INFY.token, { qty: 10, investedValue: 12_000_00 }]],
    });
    const resting = engine.place(order({ side: 'SELL', qty: 6, price: 1_600_00 }));
    expect(resting).toMatchObject({ ok: true, order: { status: 'OPEN' } });
    expect(engine.place(order({ side: 'SELL', qty: 5, price: 1_600_00 }))).toMatchObject({
      code: 'INSUFFICIENT_HOLDINGS',
      reason: expect.stringContaining('up to 4'),
    });
    // The resting order itself may grow to all 10 on modify.
    if (!resting.ok) throw new Error('expected an open order');
    expect(engine.modify(resting.order.id, { qty: 10 })).toMatchObject({ ok: true });
    expect(engine.modify(resting.order.id, { qty: 11 })).toMatchObject({
      code: 'INSUFFICIENT_HOLDINGS',
    });
  });

  it('allows an intraday short and books P&L when it is bought back', () => {
    const { engine, prices } = createHarness();
    engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 4 }));
    prices.set(INFY.token, 1_450_00);
    engine.place(marketOrder({ side: 'BUY', product: 'INTRADAY', qty: 4 }));
    expect(engine.positions()).toMatchObject([
      { product: 'INTRADAY', book: { netQty: 0, realisedPnl: 200_00 } },
    ]);
    expect(engine.fundsSummary().available).toBe(OPENING + 200_00);
  });

  it('only ever returns valid contract orders, detached from engine state', () => {
    const { engine } = createHarness();
    const placed = engine.place(order());
    const all = engine.orders();
    for (const o of all) expect(Order.safeParse(o).success).toBe(true);
    if (!placed.ok) throw new Error('expected an open order');
    (all[0] as { qty: number }).qty = 999;
    expect(engine.getOrder(placed.order.id)?.qty).toBe(10);
    expect(engine.getOrder('nope')).toBeNull();
    const [position] = engine.positions();
    expect(position).toBeUndefined();
  });
});

describe('PaperEngine.modify (T-128)', () => {
  it('re-blocks cash to the new qty × price and can fill at once', () => {
    const { engine } = createHarness();
    const placed = engine.place(order({ qty: 10, price: 1_490_00 }));
    if (!placed.ok) throw new Error('expected an open order');
    const id = placed.order.id;

    expect(engine.modify(id, { qty: 20 })).toMatchObject({ ok: true, order: { qty: 20 } });
    expect(engine.ledger.blockedFor(id)).toBe(29_800_00);
    expect(engine.modify(id, { price: 1_400_00, qty: 5 })).toMatchObject({ ok: true });
    expect(engine.ledger.blockedFor(id)).toBe(7_000_00);
    expect(engine.modify(id, { qty: 5 })).toMatchObject({ ok: true });
    expect(engine.ledger.blockedFor(id)).toBe(7_000_00);

    // A LIMIT raised to cross the market fills at the limit.
    expect(engine.modify(id, { price: 1_505_00 })).toMatchObject({
      ok: true,
      order: { status: 'EXECUTED', avgFillPrice: 1_505_00 },
    });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: OPENING - 7_525_00 });
  });

  it('turns a LIMIT into a MARKET order, which fills at LTP', () => {
    const { engine } = createHarness();
    const placed = engine.place(order());
    if (!placed.ok) throw new Error('expected an open order');
    expect(engine.modify(placed.order.id, { type: 'MARKET' })).toMatchObject({
      ok: true,
      order: { type: 'MARKET', price: null, status: 'EXECUTED', avgFillPrice: 1_500_00 },
    });
  });

  it.each<[string, ModifyOrderRequest, string]>([
    ['nothing to change', {}, 'NOTHING_TO_CHANGE'],
    ['a price off the tick', { price: 1_490_01 }, 'PRICE_OFF_TICK'],
    ['more than the cash', { qty: 1_000 }, 'INSUFFICIENT_FUNDS'],
    ['a price outside the circuit band', { price: 1_900_00 }, 'OUTSIDE_CIRCUIT'],
  ])('refuses %s and leaves the order as it was', (_name, request, code) => {
    const { engine } = createHarness({ funds: { openingBalance: 1_00_000_00 } });
    const before = engine.place(order()).order;
    if (!before) throw new Error('expected an order');
    const blocked = engine.ledger.blockedFor(before.id);
    expect(engine.modify(before.id, request)).toMatchObject({ ok: false, code, order: before });
    expect(engine.getOrder(before.id)).toEqual(before);
    expect(engine.ledger.blockedFor(before.id)).toBe(blocked);
  });

  it('refuses an unknown order', () => {
    const { engine } = createHarness();
    expect(engine.modify('nope', { qty: 1 })).toEqual({
      ok: false,
      code: 'ORDER_NOT_FOUND',
      reason: 'This order was not found.',
      order: null,
    });
    expect(engine.cancel('nope')).toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
});

describe('PaperEngine.cancel (T-128)', () => {
  it('cancels an OPEN order and releases its whole block', () => {
    const { engine, updates } = createHarness();
    const placed = engine.place(order());
    if (!placed.ok) throw new Error('expected an open order');
    expect(engine.cancel(placed.order.id)).toMatchObject({
      ok: true,
      order: { status: 'CANCELLED', statusReason: 'Cancelled by you.' },
    });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: OPENING });
    expect(updates.map((o) => o.status)).toEqual(['OPEN', 'CANCELLED']);
  });
});

describe('illegal transitions through the engine (T-128)', () => {
  // Build one order in each status, then try every user action on it.
  const inStatus = (status: OrderStatus) => {
    const harness = createHarness({ at: status === 'AMO' ? ist(25, 20, 0) : ist(25, 10, 0) });
    const { engine } = harness;
    const placed =
      status === 'EXECUTED'
        ? engine.place(marketOrder())
        : status === 'REJECTED'
          ? engine.place(order({ side: 'SELL' }))
          : engine.place(order());
    const id = placed.order?.id;
    if (id === undefined) throw new Error('expected an order');
    if (status === 'CANCELLED') engine.cancel(id);
    expect(engine.getOrder(id)?.status).toBe(status);
    return { ...harness, id };
  };

  const actions: [OrderEvent, (h: ReturnType<typeof inStatus>) => unknown][] = [
    ['MODIFY', ({ engine, id }) => engine.modify(id, { qty: 1 })],
    ['CANCEL', ({ engine, id }) => engine.cancel(id)],
  ];
  const table = (['AMO', 'OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED'] as const).flatMap((status) =>
    actions.map(([event, act]) => [status, event, act] as const),
  );

  it.each(table)('%s + %s', (status, event, act) => {
    const harness = inStatus(status);
    const before = harness.engine.getOrder(harness.id);
    const ledgerBefore = harness.engine.ledger.entries().length;
    const result = act(harness);
    if (status === 'AMO' || status === 'OPEN') {
      expect(result).toMatchObject({ ok: true });
      return;
    }
    expect(result).toEqual({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      reason: illegalTransitionReason(status, event),
      order: before,
    });
    expect(harness.engine.getOrder(harness.id)).toEqual(before);
    expect(harness.engine.ledger.entries()).toHaveLength(ledgerBefore);
  });
});

describe('PaperEngine seeding', () => {
  it('refuses a holding with no shares', () => {
    expect(() => createHarness({ holdings: [[TCS.token, { qty: 0, investedValue: 0 }]] })).toThrow(
      /at least 1/,
    );
  });
});
