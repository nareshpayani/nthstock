import { describe, expect, it } from 'vitest';
import { firstFillOnPath, matchFill, type MatchableOrder } from './fillMatcher.js';

const market = (side: MatchableOrder['side'], qty = 10): MatchableOrder => ({
  side,
  type: 'MARKET',
  qty,
  price: null,
});
const limit = (side: MatchableOrder['side'], price: number, qty = 10): MatchableOrder => ({
  side,
  type: 'LIMIT',
  qty,
  price,
});

describe('matchFill (T-065)', () => {
  it('fills a MARKET order fully at the LTP, whichever side', () => {
    expect(matchFill(market('BUY'), 250_05)).toEqual({ qty: 10, price: 250_05 });
    expect(matchFill(market('SELL', 3), 99_95)).toEqual({ qty: 3, price: 99_95 });
  });

  it('fills a LIMIT BUY at the limit when LTP is at or below it', () => {
    expect(matchFill(limit('BUY', 100_00), 100_05)).toBeNull();
    expect(matchFill(limit('BUY', 100_00), 100_00)).toEqual({ qty: 10, price: 100_00 });
    expect(matchFill(limit('BUY', 100_00), 99_50)).toEqual({ qty: 10, price: 100_00 });
  });

  it('fills a LIMIT SELL at the limit when LTP is at or above it', () => {
    expect(matchFill(limit('SELL', 100_00), 99_95)).toBeNull();
    expect(matchFill(limit('SELL', 100_00), 100_00)).toEqual({ qty: 10, price: 100_00 });
    expect(matchFill(limit('SELL', 100_00), 101_00)).toEqual({ qty: 10, price: 100_00 });
  });

  it('fills only the remaining quantity, and never refills a filled order', () => {
    expect(matchFill({ ...market('BUY', 10), filledQty: 4 }, 50_00)).toEqual({
      qty: 6,
      price: 50_00,
    });
    expect(matchFill({ ...market('BUY', 10), filledQty: 10 }, 50_00)).toBeNull();
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => matchFill(market('BUY'), 100.5)).toThrow(/integer number of paise/);
    expect(() => matchFill(market('BUY'), 0)).toThrow(/positive/);
    expect(() => matchFill(market('BUY', 0), 100_00)).toThrow(/at least 1/);
    expect(() => matchFill({ ...market('BUY'), filledQty: 11 }, 100_00)).toThrow(/Filled/);
    expect(() => matchFill({ ...market('BUY'), filledQty: -1 }, 100_00)).toThrow(/Filled/);
    expect(() => matchFill({ ...market('BUY'), price: 100_00 }, 100_00)).toThrow(/no price/);
    expect(() => matchFill({ ...limit('BUY', 1), price: null }, 100_00)).toThrow(/needs a price/);
    expect(() => matchFill(limit('SELL', 99.99), 100_00)).toThrow(/Limit price/);
  });
});

describe('scripted price paths (T-065)', () => {
  // Each row: order, a scripted LTP path in paise, and the expected first fill (or none).
  const cases: {
    name: string;
    order: MatchableOrder;
    path: number[];
    expected: { tickIndex: number; qty: number; price: number } | null;
  }[] = [
    {
      name: 'MARKET BUY fills on the first tick',
      order: market('BUY'),
      path: [101_00, 99_00],
      expected: { tickIndex: 0, qty: 10, price: 101_00 },
    },
    {
      name: 'LIMIT BUY waits while the price stays above the limit, then fills at the limit',
      order: limit('BUY', 100_00),
      path: [102_00, 101_05, 100_05, 99_90, 98_00],
      expected: { tickIndex: 3, qty: 10, price: 100_00 },
    },
    {
      name: 'LIMIT BUY fills when the price touches the limit exactly',
      order: limit('BUY', 100_00),
      path: [100_50, 100_00],
      expected: { tickIndex: 1, qty: 10, price: 100_00 },
    },
    {
      name: 'LIMIT BUY never fills if the price never comes down to the limit',
      order: limit('BUY', 100_00),
      path: [100_05, 101_00, 150_00, 100_05],
      expected: null,
    },
    {
      name: 'LIMIT SELL waits while the price stays below the limit, then fills at the limit',
      order: limit('SELL', 200_00),
      path: [195_00, 199_95, 200_10],
      expected: { tickIndex: 2, qty: 10, price: 200_00 },
    },
    {
      name: 'LIMIT SELL never fills if the price never rises to the limit',
      order: limit('SELL', 200_00),
      path: [199_95, 150_00, 199_90],
      expected: null,
    },
    {
      name: 'an empty path never fills',
      order: market('SELL'),
      path: [],
      expected: null,
    },
  ];

  it.each(cases)('$name', ({ order, path, expected }) => {
    expect(firstFillOnPath(order, path)).toEqual(expected);
  });
});
