import { FundsSummary } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { INFY, TCS, createHarness, ist, marketOrder, order } from './testHarness.js';

const SQUARE_OFF_UTC = '2026-09-25T09:50:00.000Z'; // Friday 25 Sep 2026, 3:20 PM IST
const CLOSE_UTC = '2026-09-25T10:00:00.000Z'; // 3:30 PM IST

/** One Friday of trading at 10:00 IST, with 2 TCS carried in from earlier days. */
function tradingDay() {
  const harness = createHarness({
    at: ist(25, 10, 0),
    holdings: [[TCS.token, { qty: 2, investedValue: 7_000_00 }]],
  });
  const { engine } = harness;
  engine.place(marketOrder({ qty: 10 })); // delivery BUY 10 INFY @ ₹1,500
  engine.place(marketOrder({ token: TCS.token, product: 'INTRADAY', qty: 5 })); // @ ₹3,800
  engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 3 })); // short 3 INFY @ ₹1,500
  engine.place(order({ token: TCS.token, qty: 2, price: 3_700_00 })); // OPEN delivery BUY
  engine.place(order({ side: 'SELL', product: 'INTRADAY', qty: 3, price: 1_600_00 })); // OPEN
  engine.place(marketOrder({ token: TCS.token, side: 'SELL', qty: 1 })); // 1 TCS out of holdings
  return harness;
}

const summary = (
  orders: readonly { side: string; product: string; qty: number; status: string }[],
) => orders.map((o) => `${o.side} ${String(o.qty)} ${o.product} ${o.status}`);

describe('end-of-day processing (T-130)', () => {
  it('squares off intraday at 15:20 IST and moves delivery to holdings at 15:30', () => {
    const { engine, clock, prices } = tradingDay();
    expect(summary(engine.orders())).toEqual([
      'BUY 10 DELIVERY EXECUTED',
      'BUY 5 INTRADAY EXECUTED',
      'SELL 3 INTRADAY EXECUTED',
      'BUY 2 DELIVERY OPEN',
      'SELL 3 INTRADAY OPEN',
      'SELL 1 DELIVERY EXECUTED',
    ]);

    prices.set(INFY.token, 1_520_00);
    prices.set(TCS.token, 3_850_00);
    clock.set(ist(25, 15, 19));
    expect(engine.sync()).toEqual([]);

    clock.set(ist(25, 15, 20));
    const atSquareOff = engine.sync();
    expect(atSquareOff).toMatchObject([
      {
        side: 'SELL',
        product: 'INTRADAY',
        status: 'CANCELLED',
        statusReason: 'Cancelled at the 3:20 PM IST intraday square-off.',
        updatedAt: SQUARE_OFF_UTC,
      },
      {
        symbol: 'TCS',
        side: 'SELL',
        type: 'MARKET',
        product: 'INTRADAY',
        qty: 5,
        status: 'EXECUTED',
        avgFillPrice: 3_850_00,
        statusReason: 'Squared off automatically at 3:20 PM IST.',
        clientOrderId: null,
        placedAt: SQUARE_OFF_UTC,
      },
      { symbol: 'INFY', side: 'BUY', qty: 3, status: 'EXECUTED', avgFillPrice: 1_520_00 },
    ]);
    expect(
      engine.positions().map((p) => [p.symbol, p.product, p.book.netQty, p.book.realisedPnl]),
    ).toEqual([
      ['INFY', 'DELIVERY', 10, 0],
      ['TCS', 'INTRADAY', 0, 250_00],
      ['INFY', 'INTRADAY', 0, -60_00],
    ]);
    // ₹250 + (−₹60) on intraday, ₹300 on the TCS sold out of holdings.
    expect(engine.realisedPnlToday()).toBe(490_00);

    clock.set(ist(25, 15, 30));
    expect(engine.sync()).toMatchObject([
      {
        symbol: 'TCS',
        product: 'DELIVERY',
        status: 'CANCELLED',
        statusReason: 'Cancelled at market close, 3:30 PM IST. Day orders do not carry over.',
        updatedAt: CLOSE_UTC,
      },
    ]);

    expect(summary(engine.orders())).toEqual([
      'BUY 10 DELIVERY EXECUTED',
      'BUY 5 INTRADAY EXECUTED',
      'SELL 3 INTRADAY EXECUTED',
      'BUY 2 DELIVERY CANCELLED',
      'SELL 3 INTRADAY CANCELLED',
      'SELL 1 DELIVERY EXECUTED',
      'SELL 5 INTRADAY EXECUTED',
      'BUY 3 INTRADAY EXECUTED',
    ]);
    expect(engine.positions()).toEqual([]);
    expect(engine.holdings()).toEqual([
      { token: TCS.token, lot: { qty: 1, investedValue: 3_500_00 } },
      { token: INFY.token, lot: { qty: 10, investedValue: 15_000_00 } },
    ]);
    expect(engine.holdingSales()).toEqual([]);
    expect(engine.realisedPnlToday()).toBe(0);
    // 10L − 15,000 − 19,000 + 4,500 + 3,800 + 19,250 − 4,560, all in paise.
    expect(engine.fundsSummary()).toMatchObject({ available: 9_88_990_00, blocked: 0 });
    expect(engine.ledger.entries().at(-1)?.createdAt).toBe(CLOSE_UTC);
  });

  it('gives the same end state, stamped at 15:20 and 15:30, when one sync comes after the close', () => {
    const stepped = tradingDay();
    const jumped = tradingDay();
    for (const { prices } of [stepped, jumped]) {
      prices.set(INFY.token, 1_520_00);
      prices.set(TCS.token, 3_850_00);
    }
    stepped.clock.set(ist(25, 15, 20));
    stepped.engine.sync();
    stepped.clock.set(ist(25, 15, 30));
    stepped.engine.sync();
    stepped.clock.set(ist(25, 17, 0));
    stepped.engine.sync();

    jumped.clock.set(ist(25, 17, 0));
    const changed = jumped.engine.sync();
    expect(changed.map((o) => o.updatedAt)).toEqual([
      SQUARE_OFF_UTC,
      SQUARE_OFF_UTC,
      SQUARE_OFF_UTC,
      CLOSE_UTC,
    ]);
    expect(jumped.engine.orders()).toEqual(stepped.engine.orders());
    expect(jumped.engine.holdings()).toEqual(stepped.engine.holdings());
    expect(jumped.engine.ledger.entries()).toEqual(stepped.engine.ledger.entries());
    expect(jumped.engine.fundsSummary()).toEqual(stepped.engine.fundsSummary());
  });

  it('runs Friday’s events once, at Friday’s times, when the next sync is on Monday', () => {
    const { engine, clock, updates } = createHarness({ at: ist(25, 10, 0) });
    engine.place(marketOrder({ product: 'INTRADAY', qty: 2 }));
    engine.place(marketOrder({ qty: 4 }));
    engine.place(order({ qty: 1, price: 1_450_00 }));
    const before = updates.length;
    clock.set(ist(28, 10, 0));
    const changed = engine.sync();
    expect(changed.map((o) => [o.side, o.product, o.status, o.updatedAt])).toEqual([
      ['SELL', 'INTRADAY', 'EXECUTED', SQUARE_OFF_UTC],
      ['BUY', 'DELIVERY', 'CANCELLED', CLOSE_UTC],
    ]);
    expect(updates.length - before).toBe(2); // the square-off appears once, already EXECUTED
    expect(engine.holdings()).toEqual([
      { token: INFY.token, lot: { qty: 4, investedValue: 6_000_00 } },
    ]);
    expect(engine.positions()).toEqual([]);
  });

  it('runs nothing on an NSE holiday: an order stays AMO until the next session', () => {
    // Monday 14 Sep 2026 is Ganesh Chaturthi.
    const { engine, clock } = createHarness({ at: ist(14, 10, 0) });
    expect(engine.place(order({ price: 1_450_00 })).order?.status).toBe('AMO');
    clock.set(ist(14, 16, 0));
    expect(engine.sync()).toEqual([]);
    clock.set(ist(15, 9, 15));
    expect(engine.sync()).toMatchObject([{ status: 'OPEN' }]);
    clock.set(ist(15, 15, 30));
    expect(engine.sync()).toMatchObject([{ status: 'CANCELLED' }]);
  });

  it('adds today’s delivery buys to an existing holding at cost; a round trip adds nothing', () => {
    const { engine, clock } = createHarness({
      holdings: [[INFY.token, { qty: 5, investedValue: 6_000_00 }]],
    });
    engine.place(marketOrder({ qty: 10 }));
    engine.place(marketOrder({ token: TCS.token, qty: 2 }));
    engine.place(marketOrder({ token: TCS.token, side: 'SELL', qty: 2 }));
    clock.set(ist(25, 15, 30));
    engine.sync();
    expect(engine.holdings()).toEqual([
      { token: INFY.token, lot: { qty: 15, investedValue: 21_000_00 } },
    ]);
  });

  it('always buys back a short at 15:20, even into a debit balance', () => {
    const { engine, clock, prices } = createHarness({ funds: { openingBalance: 10_000_00 } });
    engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 6 })); // +₹9,000
    engine.place(marketOrder({ qty: 12 })); // −₹18,000, ₹1,000 left
    prices.set(INFY.token, 1_700_00);
    clock.set(ist(25, 15, 20));
    expect(engine.sync()).toMatchObject([{ side: 'BUY', qty: 6, status: 'EXECUTED' }]);
    const funds = FundsSummary.parse(engine.fundsSummary());
    expect(funds).toMatchObject({ available: -9_200_00, realisedPnlToday: -1_200_00 });
    // A debit balance refuses every new BUY.
    expect(engine.place(marketOrder({ qty: 1 }))).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('squares off at the average price, on the tick, when there is no LTP', () => {
    const { engine, clock, prices } = createHarness();
    prices.set(INFY.token, 1_000_05);
    engine.place(marketOrder({ product: 'INTRADAY', qty: 1 }));
    prices.set(INFY.token, 1_000_10);
    engine.place(marketOrder({ product: 'INTRADAY', qty: 1 }));
    prices.delete(INFY.token);
    clock.set(ist(25, 15, 20));
    // Average ₹1,000.075 rounds to the tick at ₹1,000.10.
    expect(engine.sync()).toMatchObject([{ side: 'SELL', qty: 2, avgFillPrice: 1_000_10 }]);
  });

  it('leaves AMOs placed after the close for the next session', () => {
    const { engine, clock } = createHarness({ at: ist(25, 15, 45) });
    expect(engine.place(order()).order?.status).toBe('AMO');
    clock.set(ist(25, 23, 0));
    expect(engine.sync()).toEqual([]);
    expect(engine.orders('AMO')).toHaveLength(1);
  });
});
