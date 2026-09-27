import type { Position } from '@nthstock/contracts';
import { applyTrades, positionValues } from '@nthstock/paperEngine';
import { describe, expect, it } from 'vitest';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { createLivePositionsSelector, livePosition, positionBook, storeLtp } from './livePnl';

/** A position as the server sends it: the engine's own math on the trades, at `ltp`. */
function serverPosition(
  symbol: string,
  product: Position['product'],
  trades: Parameters<typeof applyTrades>[0],
  ltp: number,
): Position {
  const values = positionValues(applyTrades(trades), ltp);
  return {
    token: 100 + symbol.length,
    symbol,
    exchange: 'NSE',
    product,
    netQty: values.netQty,
    buyQty: values.buyQty,
    sellQty: values.sellQty,
    avgBuyPrice: values.avgBuyPrice,
    avgSellPrice: values.avgSellPrice,
    ltp,
    realisedPnl: values.realisedPnl,
    unrealisedPnl: values.unrealisedPnl,
  };
}

const infyLong = serverPosition(
  'INFY',
  'DELIVERY',
  [
    { side: 'BUY', qty: 10, price: 1_500_05 },
    { side: 'BUY', qty: 5, price: 1_512_35 },
    { side: 'SELL', qty: 3, price: 1_520_00 },
  ],
  1_510_00,
);
const infyShort = serverPosition(
  'INFY',
  'INTRADAY',
  [{ side: 'SELL', qty: 7, price: 1_511_00 }],
  1_510_00,
);
const tcsLong = serverPosition(
  'TCS',
  'INTRADAY',
  [{ side: 'BUY', qty: 2, price: 3_800_00 }],
  3_805_00,
);

describe('live position P&L (T-148)', () => {
  it('matches the paper engine at any price, from the snapshot alone', () => {
    const trades = [
      { side: 'BUY', qty: 10, price: 1_500_05 },
      { side: 'BUY', qty: 5, price: 1_512_35 },
      { side: 'SELL', qty: 3, price: 1_520_00 },
    ] as const;
    for (const ltp of [1_400_00, 1_510_00, 1_533_55, 1_700_00]) {
      const engine = positionValues(applyTrades(trades), ltp);
      const live = livePosition(infyLong, ltp);
      expect([live.unrealisedPnl, live.realisedPnl, live.pnl, live.avgPrice]).toEqual([
        engine.unrealisedPnl,
        engine.realisedPnl,
        engine.dayPnl,
        engine.avgPrice,
      ]);
    }
    // A short loses as the price rises.
    expect(livePosition(infyShort, 1_520_00).unrealisedPnl).toBe(-7 * 9_00);
    expect(positionBook(infyShort).openCost).toBe(7 * 1_511_00);
  });

  it('keeps the snapshot values until a live price arrives', () => {
    expect(livePosition(tcsLong, undefined)).toMatchObject({
      ltp: 3_805_00,
      unrealisedPnl: 2 * 5_00,
      pnl: 2 * 5_00,
    });
  });

  it('a tick changes only the P&L of positions in that symbol', () => {
    const quotes = createTestQuoteStore();
    const select = createLivePositionsSelector();
    const positions = [infyLong, infyShort, tcsLong];
    quotes.push(testQuote('INFY', 1_510_00), testQuote('TCS', 3_805_00));
    const before = select(positions, storeLtp(quotes.store));
    expect(select(positions, storeLtp(quotes.store))).toBe(before);

    quotes.push(testQuote('TCS', 3_820_00));
    const after = select(positions, storeLtp(quotes.store));
    expect(after).not.toBe(before);
    // Both INFY rows are the very same objects; only the TCS row was recomputed.
    expect(after.rows[0]).toBe(before.rows[0]);
    expect(after.rows[1]).toBe(before.rows[1]);
    expect(after.rows[2]).not.toBe(before.rows[2]);
    expect(after.rows[2]?.unrealisedPnl).toBe(2 * 20_00);
    expect(after.totals.pnl - before.totals.pnl).toBe(2 * 15_00);

    quotes.push(testQuote('INFY', 1_500_00));
    const third = select(positions, storeLtp(quotes.store));
    expect(third.rows[2]).toBe(after.rows[2]);
    expect(third.rows[0]).not.toBe(after.rows[0]);
    expect(third.rows[1]?.unrealisedPnl).toBe(7 * 11_00);
  });

  it('totals realised and unrealised P&L over every row', () => {
    const select = createLivePositionsSelector();
    const { rows, totals } = select([infyLong, infyShort, tcsLong], () => undefined);
    expect(totals.realisedPnl).toBe(rows.reduce((sum, row) => sum + row.realisedPnl, 0));
    expect(totals.unrealisedPnl).toBe(rows.reduce((sum, row) => sum + row.unrealisedPnl, 0));
    expect(totals.pnl).toBe(totals.realisedPnl + totals.unrealisedPnl);
  });
});
