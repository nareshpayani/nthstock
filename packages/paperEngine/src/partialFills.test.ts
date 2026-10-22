import { describe, expect, it } from 'vitest';
import { INFY, createHarness, ist, marketOrder, order } from './testHarness.js';

const OPENING = 10_00_000_00;

/** A harness whose LIMIT orders in INFY fill at most `cap` shares per tick. */
const capped = (cap: number, options: Parameters<typeof createHarness>[0] = {}) =>
  createHarness({ ...options, fillCap: (token) => (token === INFY.token ? cap : null) });

describe('partial fills under a per-tick cap (SPEC-TFC-1 §10.3, T05)', () => {
  it('fills a 10-share limit 3 + 3 + 3 + 1 under a cap of 3, one part per tick', () => {
    const { engine, prices, updates } = capped(3);
    const placed = engine.place(order({ qty: 10, price: 1_500_00 }));
    expect(placed).toMatchObject({ ok: true, order: { status: 'OPEN', filledQty: 3 } });
    if (!placed.ok) throw new Error('expected an open order');
    const { id } = placed.order;

    // Syncing again on the same tick fills nothing more.
    engine.sync();
    expect(engine.getOrder(id)).toMatchObject({ status: 'OPEN', filledQty: 3 });

    prices.set(INFY.token, 1_500_00);
    engine.sync();
    expect(engine.getOrder(id)).toMatchObject({ status: 'OPEN', filledQty: 6 });
    prices.set(INFY.token, 1_499_00);
    engine.sync();
    expect(engine.getOrder(id)).toMatchObject({ status: 'OPEN', filledQty: 9 });
    prices.set(INFY.token, 1_498_00);
    engine.sync();
    expect(engine.getOrder(id)).toMatchObject({
      status: 'EXECUTED',
      filledQty: 10,
      avgFillPrice: 1_500_00,
    });

    expect(engine.orderHistory(id)?.map((e) => [e.event, e.status, e.fillQty])).toEqual([
      ['PLACED', 'OPEN', undefined],
      ['PARTIALLY_EXECUTED', 'OPEN', 3],
      ['PARTIALLY_EXECUTED', 'OPEN', 3],
      ['PARTIALLY_EXECUTED', 'OPEN', 3],
      ['EXECUTED', 'EXECUTED', 1],
    ]);
    expect(updates.map((o) => [o.status, o.filledQty])).toEqual([
      ['OPEN', 0],
      ['OPEN', 3],
      ['OPEN', 6],
      ['OPEN', 9],
      ['EXECUTED', 10],
    ]);
    expect(engine.positions()[0]?.book).toMatchObject({ buyQty: 10, netQty: 10 });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: OPENING - 15_000_00 });
  });

  it('releases blocked cash pro rata on each part and keeps the ledger whole', () => {
    const { engine, prices } = capped(4);
    const placed = engine.place(order({ qty: 10, price: 1_490_00 }));
    if (!placed.ok) throw new Error('expected an open order');
    const { id } = placed.order;
    expect(engine.ledger.blockedFor(id)).toBe(14_900_00);

    prices.set(INFY.token, 1_490_00);
    engine.sync();
    expect(engine.ledger.blockedFor(id)).toBe(6 * 1_490_00);
    expect(engine.fundsSummary()).toMatchObject({
      blocked: 6 * 1_490_00,
      available: OPENING - 10 * 1_490_00,
    });
    const entries = engine.ledger.entries();
    expect(entries.reduce((t, e) => t + e.amount, 0)).toBe(engine.ledger.available);
    expect(entries.slice(-2).map((e) => [e.type, e.amount])).toEqual([
      ['ORDER_RELEASE', 4 * 1_490_00],
      ['TRADE_DEBIT', -4 * 1_490_00],
    ]);
  });

  it('keeps the exact volume-weighted average across fills at different prices', () => {
    const { engine, prices } = capped(1);
    const placed = engine.place(order({ qty: 3, price: 1_500_00 }));
    if (!placed.ok) throw new Error('expected an open order');
    const { id } = placed.order;
    // Arrival: marketable, fills 1 at the LTP 1,500.00. Then two resting fills at the limit.
    expect(engine.getOrder(id)).toMatchObject({ filledQty: 1, avgFillPrice: 1_500_00 });
    engine.modify(id, { price: 1_500_05 });
    expect(engine.getOrder(id)).toMatchObject({ filledQty: 1 });
    prices.set(INFY.token, 1_500_00);
    engine.sync();
    prices.set(INFY.token, 1_499_00);
    engine.sync();
    // (1,500.00 + 1,500.05 + 1,500.05) / 3 = 1,500.0333…, rounded to the paisa.
    expect(engine.getOrder(id)).toMatchObject({ status: 'EXECUTED', avgFillPrice: 1_500_03 });
    expect(engine.fundsSummary()).toMatchObject({
      blocked: 0,
      available: OPENING - (1_500_00 + 2 * 1_500_05),
    });
  });

  it('never caps a MARKET order', () => {
    const { engine } = capped(3);
    expect(engine.place(marketOrder({ qty: 10 }))).toMatchObject({
      ok: true,
      order: { status: 'EXECUTED', filledQty: 10 },
    });
  });

  it('modifies a partly filled order for the shares still to fill', () => {
    const { engine } = capped(3);
    const placed = engine.place(order({ qty: 10, price: 1_500_00 }));
    if (!placed.ok) throw new Error('expected an open order');
    const { id } = placed.order;
    expect(engine.getOrder(id)).toMatchObject({ filledQty: 3 });

    expect(engine.modify(id, { qty: 3 })).toMatchObject({
      ok: false,
      code: 'INVALID_QTY',
      reason: '3 shares have already filled. Enter a quantity above 3.',
    });
    // Down to 5 at a resting price: only the 2 left to fill hold cash.
    expect(engine.modify(id, { qty: 5, price: 1_480_00 })).toMatchObject({
      ok: true,
      order: { qty: 5, filledQty: 3, status: 'OPEN' },
    });
    expect(engine.ledger.blockedFor(id)).toBe(2 * 1_480_00);
  });

  it('releases only what is left when a partly filled order is cancelled', () => {
    const { engine } = capped(3);
    const placed = engine.place(order({ qty: 10, price: 1_500_00 }));
    if (!placed.ok) throw new Error('expected an open order');
    expect(engine.cancel(placed.order.id)).toMatchObject({
      ok: true,
      order: { status: 'CANCELLED', filledQty: 3 },
    });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: OPENING - 4_500_00 });
    expect(engine.positions()[0]?.book).toMatchObject({ netQty: 3 });
  });

  it('cancels the unfilled part of an intraday order at the square-off and closes the rest', () => {
    const { engine, clock } = capped(3, { at: ist(25, 15, 0) });
    const placed = engine.place(order({ qty: 10, price: 1_500_00, product: 'INTRADAY' }));
    if (!placed.ok) throw new Error('expected an open order');
    clock.set(ist(25, 15, 21));
    engine.sync();
    expect(engine.getOrder(placed.order.id)).toMatchObject({ status: 'CANCELLED', filledQty: 3 });
    expect(engine.positions()[0]?.book).toMatchObject({ netQty: 0, buyQty: 3, sellQty: 3 });
    expect(engine.fundsSummary().blocked).toBe(0);
  });
});

describe('marketable limits and IOC (SPEC-TFC-1 §10.3, §11.2, T05)', () => {
  it('fills a marketable limit at the better price on arrival', () => {
    const { engine } = createHarness();
    expect(engine.place(order({ price: 1_510_00 }))).toMatchObject({
      ok: true,
      order: { status: 'EXECUTED', avgFillPrice: 1_500_00 },
    });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: OPENING - 15_000_00 });
  });

  it('fills a resting limit at its limit when a later tick crosses it', () => {
    const { engine, prices } = createHarness();
    const placed = engine.place(order({ price: 1_490_00 }));
    if (!placed.ok) throw new Error('expected an open order');
    prices.set(INFY.token, 1_480_00);
    engine.sync();
    expect(engine.getOrder(placed.order.id)).toMatchObject({
      status: 'EXECUTED',
      avgFillPrice: 1_490_00,
    });
  });

  it('fills an IOC order in full when it can', () => {
    const { engine } = createHarness();
    expect(engine.place(order({ price: 1_500_00, validity: 'IOC' }))).toMatchObject({
      ok: true,
      order: { status: 'EXECUTED', filledQty: 10, validity: 'IOC' },
    });
  });

  it('cancels what an IOC order could not fill on arrival', () => {
    const { engine } = capped(3);
    const placed = engine.place(order({ qty: 10, price: 1_500_00, validity: 'IOC' }));
    expect(placed).toMatchObject({
      ok: true,
      order: {
        status: 'CANCELLED',
        filledQty: 3,
        statusReason: 'Immediate or cancel: 7 of 10 shares did not fill and were cancelled.',
      },
    });
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: OPENING - 4_500_00 });
  });

  it('cancels an IOC limit that does not cross at once, releasing its cash', () => {
    const { engine, prices } = createHarness();
    const placed = engine.place(order({ price: 1_490_00, validity: 'IOC' }));
    expect(placed).toMatchObject({ ok: true, order: { status: 'CANCELLED', filledQty: 0 } });
    if (!placed.ok) throw new Error('expected an order');
    expect(engine.orderHistory(placed.order.id)?.map((e) => e.event)).toEqual([
      'PLACED',
      'CANCELLED',
    ]);
    prices.set(INFY.token, 1_480_00);
    engine.sync();
    expect(engine.getOrder(placed.order.id)?.status).toBe('CANCELLED');
    expect(engine.fundsSummary()).toMatchObject({ blocked: 0, available: OPENING });
  });

  it('refuses an IOC order while the market is closed instead of keeping it as an AMO', () => {
    const { engine, updates } = createHarness({ at: ist(25, 18, 0) });
    expect(engine.place(order({ validity: 'IOC' }))).toEqual({
      ok: false,
      code: 'NOT_SUPPORTED',
      reason: 'Immediate-or-cancel orders can be placed only while the market is open.',
      order: null,
    });
    expect(updates).toEqual([]);
  });
});
