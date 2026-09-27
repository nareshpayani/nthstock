import { describe, expect, it } from 'vitest';
import { INFY, TCS, createHarness, ist, marketOrder, order } from './testHarness.js';

const MINUTE = 60_000;

describe('AMO (T-129)', () => {
  it('stores an order at 20:00 IST as AMO and executes it at 9:15 on the next trading day', () => {
    // Friday 25 Sep 2026, 8 PM IST. The next trading day is Monday 28 Sep.
    const { engine, clock, prices, updates } = createHarness({ at: ist(25, 20, 0) });
    const placed = engine.place(marketOrder({ qty: 10 }));
    expect(placed).toMatchObject({
      ok: true,
      order: { status: 'AMO', placedAt: '2026-09-25T14:30:00.000Z', filledQty: 0 },
    });
    expect(engine.fundsSummary().blocked).toBe(15_000_00);

    clock.set(ist(28, 9, 14));
    expect(engine.sync()).toEqual([]);
    expect(engine.orders('AMO')).toHaveLength(1);

    prices.set(INFY.token, 1_510_00);
    clock.set(ist(28, 9, 15));
    const changed = engine.sync();
    expect(changed).toMatchObject([
      {
        status: 'EXECUTED',
        filledQty: 10,
        avgFillPrice: 1_510_00,
        updatedAt: '2026-09-28T03:45:00.000Z',
      },
    ]);
    expect(updates.map((o) => o.status)).toEqual(['AMO', 'OPEN', 'EXECUTED']);
    // The block moved to the opening price, then settled.
    expect(engine.fundsSummary()).toMatchObject({
      blocked: 0,
      available: 10_00_000_00 - 15_100_00,
    });
  });

  it('opens a LIMIT AMO at 9:15 when the price has not crossed, and fills it later', () => {
    const { engine, clock, prices } = createHarness({ at: ist(25, 20, 0) });
    const placed = engine.place(order({ price: 1_450_00 }));
    expect(placed.order?.status).toBe('AMO');

    clock.set(ist(28, 9, 15));
    expect(engine.sync()).toMatchObject([{ status: 'OPEN', price: 1_450_00 }]);
    expect(engine.fundsSummary().blocked).toBe(14_500_00);

    clock.set(ist(28, 9, 30));
    prices.set(INFY.token, 1_449_00);
    expect(engine.sync()).toMatchObject([{ status: 'EXECUTED', avgFillPrice: 1_450_00 }]);
  });

  // [placed at, first 9:15 IST that releases it, why]
  const releases: [Date, Date, string][] = [
    [ist(25, 20, 0), ist(28, 9, 15), 'Friday evening → Monday'],
    [ist(26, 11, 0), ist(28, 9, 15), 'Saturday → Monday'],
    [ist(27, 23, 59), ist(28, 9, 15), 'Sunday night → Monday'],
    [ist(25, 9, 5), ist(25, 9, 15), 'pre-open → the same morning'],
    [ist(25, 0, 30), ist(25, 9, 15), 'just after midnight → the same morning'],
    [ist(25, 15, 30), ist(28, 9, 15), 'at the 15:30 close → the next trading day'],
    [ist(28, 19, 0), ist(29, 9, 15), 'Monday evening → Tuesday'],
    [
      ist(1, 20, 0, 10),
      ist(5, 9, 15, 10),
      'Thursday → Monday, over Gandhi Jayanti on Friday 2 Oct',
    ],
    [ist(13, 12, 0), ist(15, 9, 15), 'Sunday → Tuesday, over Ganesh Chaturthi on Monday 14 Sep'],
    [ist(24, 20, 0, 12), ist(28, 9, 15, 12), 'Thursday → Monday, over Christmas on Friday'],
  ];

  it.each(releases)(
    '%s is released at %s (%s)',
    (placedAt, releaseAt) => {
      const { engine, clock, prices } = createHarness({ at: placedAt });
      // A limit far below the market, so release opens it without filling.
      const placed = engine.place(order({ price: 1_300_00 }));
      expect(placed.order?.status).toBe('AMO');

      // Step through every quarter hour up to one minute before the release: still AMO.
      for (let t = placedAt.getTime(); t < releaseAt.getTime() - MINUTE; t += 15 * MINUTE) {
        clock.set(t);
        expect(engine.sync()).toEqual([]);
      }
      clock.set(releaseAt.getTime() - MINUTE);
      engine.sync();
      expect(engine.orders()[0]?.status).toBe('AMO');

      clock.set(releaseAt);
      expect(engine.sync()).toMatchObject([{ status: 'OPEN', updatedAt: releaseAt.toISOString() }]);
      prices.set(INFY.token, 1_300_00);
      expect(engine.sync()).toMatchObject([{ status: 'EXECUTED' }]);
    },
    20_000,
  );

  it('stamps the release at 9:15 even when the next sync comes much later', () => {
    const { engine, clock } = createHarness({ at: ist(25, 20, 0) });
    engine.place(marketOrder());
    clock.set(ist(28, 11, 42));
    expect(engine.sync()).toMatchObject([
      { status: 'EXECUTED', updatedAt: '2026-09-28T03:45:00.000Z' },
    ]);
    const debit = engine.ledger.entries().find((e) => e.type === 'TRADE_DEBIT');
    expect(debit?.createdAt).toBe('2026-09-28T03:45:00.000Z');
  });

  it('releases AMOs before placing a new order when the clock has passed 9:15', () => {
    const { engine, clock } = createHarness({ at: ist(25, 20, 0) });
    engine.place(marketOrder({ qty: 1 }));
    clock.set(ist(28, 10, 0));
    const next = engine.place(marketOrder({ qty: 2 }));
    expect(next.order?.status).toBe('EXECUTED');
    expect(engine.orders().map((o) => [o.qty, o.status])).toEqual([
      [1, 'EXECUTED'],
      [2, 'EXECUTED'],
    ]);
  });

  it('rejects an AMO at release when the cash no longer covers the opening price', () => {
    const { engine, clock, prices } = createHarness({
      at: ist(25, 20, 0),
      funds: { openingBalance: 15_000_00 },
    });
    const placed = engine.place(marketOrder({ qty: 10 }));
    expect(placed.order?.status).toBe('AMO');
    prices.set(INFY.token, 1_600_00);
    clock.set(ist(28, 9, 15));
    expect(engine.sync()).toMatchObject([
      {
        status: 'REJECTED',
        statusReason: 'Not enough cash: this order needs ₹16,000.00 and ₹15,000.00 is available.',
      },
    ]);
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: 15_000_00 });
    const id = placed.order?.id ?? '';
    expect(engine.cancel(id)).toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });

  it('rejects a LIMIT AMO outside the new day’s circuit band, keyed by clientOrderId', () => {
    const { engine, clock, instruments } = createHarness({ at: ist(25, 20, 0) });
    const placed = engine.place(order({ price: 1_750_00, clientOrderId: 'amo-1' }));
    expect(placed.order?.status).toBe('AMO');
    // The adapter moves the band with the new previous close.
    instruments.set({ ...INFY, lowerCircuit: 1_300_00, upperCircuit: 1_700_00 });
    clock.set(ist(28, 9, 15));
    expect(engine.sync()).toMatchObject([{ status: 'REJECTED' }]);
    // A retry with the same clientOrderId reports the stored rejection.
    expect(engine.place(order({ price: 1_750_00, clientOrderId: 'amo-1' }))).toMatchObject({
      ok: false,
      code: 'OUTSIDE_CIRCUIT',
      reason: expect.stringContaining('₹1,300.00 to ₹1,700.00'),
    });
  });

  it('rejects intraday orders outside market hours instead of storing them as AMO', () => {
    const { engine } = createHarness({ at: ist(25, 20, 0) });
    expect(engine.place(marketOrder({ product: 'INTRADAY' }))).toMatchObject({
      ok: false,
      code: 'INTRADAY_MARKET_CLOSED',
      order: { status: 'REJECTED' },
    });
  });

  it('lets an AMO be modified and cancelled before release', () => {
    const { engine } = createHarness({ at: ist(26, 11, 0) });
    const placed = engine.place(order({ price: 1_450_00 }));
    const id = placed.order?.id ?? '';
    expect(engine.modify(id, { qty: 4, price: 1_455_00 })).toMatchObject({
      ok: true,
      order: { status: 'AMO', qty: 4, price: 1_455_00 },
    });
    expect(engine.ledger.blockedFor(id)).toBe(5_820_00);
    expect(engine.modify(id, { type: 'MARKET' })).toMatchObject({
      ok: true,
      order: { status: 'AMO', type: 'MARKET', price: null },
    });
    expect(engine.ledger.blockedFor(id)).toBe(6_000_00);
    expect(engine.modify(id, { type: 'LIMIT' })).toMatchObject({
      ok: false,
      code: 'PRICE_REQUIRED',
      order: { type: 'MARKET' },
    });
    expect(engine.cancel(id)).toMatchObject({ ok: true, order: { status: 'CANCELLED' } });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: 10_00_000_00 });
  });

  it('reserves holdings for a delivery SELL AMO and sells them at 9:15', () => {
    const { engine, clock } = createHarness({
      at: ist(25, 20, 0),
      holdings: [[TCS.token, { qty: 5, investedValue: 17_500_00 }]],
    });
    const sell = engine.place(marketOrder({ token: TCS.token, side: 'SELL', qty: 5 }));
    expect(sell.order?.status).toBe('AMO');
    expect(engine.place(marketOrder({ token: TCS.token, side: 'SELL', qty: 1 }))).toMatchObject({
      code: 'INSUFFICIENT_HOLDINGS',
    });
    clock.set(ist(28, 9, 15));
    expect(engine.sync()).toMatchObject([{ status: 'EXECUTED', avgFillPrice: 3_800_00 }]);
    expect(engine.holdings()).toEqual([]);
    expect(engine.realisedPnlToday()).toBe(5 * 3_800_00 - 17_500_00);
  });

  it('follows a clock moved backwards without replaying finished orders', () => {
    const { engine, clock, updates } = createHarness({ at: ist(25, 20, 0) });
    engine.place(order({ price: 1_300_00 }));
    clock.set(ist(28, 9, 15));
    engine.sync();
    // A test clock override jumps back to Friday evening: a new order is an AMO again.
    clock.set(ist(25, 21, 0));
    expect(engine.place(order({ price: 1_300_00 })).order?.status).toBe('AMO');
    clock.set(ist(28, 9, 20));
    expect(engine.sync()).toMatchObject([{ status: 'OPEN', qty: 10 }]);
    expect(updates.map((o) => o.status)).toEqual(['AMO', 'OPEN', 'AMO', 'OPEN']);
    expect(engine.orders().map((o) => o.status)).toEqual(['OPEN', 'OPEN']);
  });
});
