import type { Holding } from '@nthstock/contracts';
import { holdingValues } from '@nthstock/paperEngine';
import { describe, expect, it } from 'vitest';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import {
  createLiveHoldingsSelector,
  holdingsTotals,
  liveHolding,
  storeQuote,
} from './liveHoldings';

function serverHolding(symbol: string, qty: number, invested: number, ltp: number, prev: number) {
  const row: Holding = {
    token: 100 + symbol.length,
    symbol,
    exchange: 'NSE',
    ...holdingValues({ qty, investedValue: invested }, ltp, prev),
  };
  return row;
}

const infy = serverHolding('INFY', 10, 15_000_00, 1_520_00, 1_480_00);
const tcs = serverHolding('TCS', 3, 11_250_15, 3_800_00, 3_810_00);

describe('live holdings (T-148)', () => {
  it('values a holding at the live LTP: current value is qty × LTP in paise', () => {
    const live = liveHolding(infy, { ltp: 1_530_05, prevClose: 1_480_00 });
    expect(live).toMatchObject({
      ltp: 1_530_05,
      currentValue: 10 * 1_530_05,
      pnl: 10 * 1_530_05 - 15_000_00,
      dayChange: 10 * (1_530_05 - 1_480_00),
    });
    // Without a previous close in the quote, it comes from the snapshot's own day change.
    expect(liveHolding(infy, { ltp: 1_530_05, prevClose: 0 }).dayChange).toBe(
      10 * (1_530_05 - 1_480_00),
    );
    expect(liveHolding(infy, undefined)).toBe(infy);
  });

  it('totals equal the sums of the rows after each tick', () => {
    const quotes = createTestQuoteStore();
    const select = createLiveHoldingsSelector();
    const holdings = [infy, tcs];
    for (const [infyLtp, tcsLtp] of [
      [1_520_00, 3_800_00],
      [1_525_50, 3_800_00],
      [1_525_50, 3_755_45],
    ] as const) {
      quotes.push(
        testQuote('INFY', infyLtp, { prevClose: 1_480_00 }),
        testQuote('TCS', tcsLtp, { prevClose: 3_810_00 }),
      );
      const { rows, totals } = select(holdings, storeQuote(quotes.store));
      expect(totals.currentValue).toBe(rows.reduce((sum, row) => sum + row.currentValue, 0));
      expect(totals.investedValue).toBe(infy.investedValue + tcs.investedValue);
      expect(totals.totalPnl).toBe(rows.reduce((sum, row) => sum + row.pnl, 0));
      expect(totals.dayPnl).toBe(rows.reduce((sum, row) => sum + row.dayChange, 0));
      expect(totals).toEqual(holdingsTotals(rows));
    }
  });

  it('a tick in one symbol recomputes only that holding', () => {
    const quotes = createTestQuoteStore();
    const select = createLiveHoldingsSelector();
    const holdings = [infy, tcs];
    quotes.push(testQuote('INFY', 1_520_00, { prevClose: 1_480_00 }));
    const before = select(holdings, storeQuote(quotes.store));
    expect(select(holdings, storeQuote(quotes.store))).toBe(before);
    quotes.push(testQuote('INFY', 1_521_00, { prevClose: 1_480_00 }));
    const after = select(holdings, storeQuote(quotes.store));
    expect(after.rows[1]).toBe(before.rows[1]);
    expect(after.rows[0]?.currentValue).toBe(10 * 1_521_00);
  });
});
