import { Holding, Position } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_POSITION,
  applyTrade,
  applyTrades,
  averagePrice,
  basisPoints,
  holdingValues,
  mulDivRound,
  positionValues,
  unrealisedPnl,
  type Trade,
} from './positionMath.js';

const buy = (qty: number, price: number): Trade => ({ side: 'BUY', qty, price });
const sell = (qty: number, price: number): Trade => ({ side: 'SELL', qty, price });

describe('position math (T-067)', () => {
  it('buy 10 @ ₹100 and 10 @ ₹110 averages ₹105; selling 5 @ ₹120 realises ₹75.00', () => {
    const bought = applyTrades([buy(10, 100_00), buy(10, 110_00)]);
    expect(bought.netQty).toBe(20);
    expect(averagePrice(bought)).toBe(105_00);
    expect(bought.realisedPnl).toBe(0);

    const afterSell = applyTrade(bought, sell(5, 120_00));
    expect(afterSell.realisedPnl).toBe(75_00);
    expect(afterSell.netQty).toBe(15);
    expect(averagePrice(afterSell)).toBe(105_00);
    // 15 left at ₹105; at ₹115 that is 15 × ₹10 unrealised.
    expect(unrealisedPnl(afterSell, 115_00)).toBe(150_00);
  });

  it('does not change the book it is given', () => {
    const book = applyTrade(EMPTY_POSITION, buy(1, 100_00));
    applyTrade(book, sell(1, 90_00));
    expect(book.netQty).toBe(1);
    expect(Object.isFrozen(EMPTY_POSITION)).toBe(true);
  });

  it('closes a long fully and returns to flat with no cost left', () => {
    const book = applyTrades([buy(10, 100_00), sell(10, 95_00)]);
    expect(book).toMatchObject({ netQty: 0, openCost: 0, realisedPnl: -50_00 });
    expect(averagePrice(book)).toBe(0);
    expect(unrealisedPnl(book, 1_00)).toBe(0);
  });

  it('handles an intraday short: sell first, buy to cover', () => {
    const short = applyTrade(EMPTY_POSITION, sell(10, 100_00));
    expect(short.netQty).toBe(-10);
    expect(averagePrice(short)).toBe(100_00);
    expect(unrealisedPnl(short, 90_00)).toBe(100_00);
    const covered = applyTrade(short, buy(4, 90_00));
    expect(covered).toMatchObject({ netQty: -6, realisedPnl: 40_00 });
  });

  it('flips through zero: closes the open side, opens the rest at the trade price', () => {
    const flipped = applyTrades([buy(10, 100_00), sell(15, 110_00)]);
    expect(flipped).toMatchObject({ netQty: -5, openCost: 550_00, realisedPnl: 100_00 });
    expect(averagePrice(flipped)).toBe(110_00);
    const back = applyTrade(flipped, buy(8, 105_00));
    expect(back).toMatchObject({ netQty: 3, openCost: 315_00, realisedPnl: 125_00 });
  });

  it('never loses a paisa to rounding: partial closes remove rounded shares, the last removes the rest', () => {
    // 3 shares cost ₹300.05 → average ₹100.0166…, shown as ₹100.02.
    const book = applyTrades([buy(1, 100_05), buy(2, 100_00)]);
    expect(averagePrice(book)).toBe(100_02);
    const once = applyTrade(book, sell(1, 100_00));
    expect(once.openCost).toBe(200_03);
    const flat = applyTrade(once, sell(2, 100_00));
    expect(flat.openCost).toBe(0);
    expect(flat.realisedPnl).toBe(flat.sellValue - flat.buyValue);
  });

  it('fills the Position contract numbers, including day P&L', () => {
    const book = applyTrades([buy(10, 100_00), buy(10, 110_00), sell(5, 120_00)]);
    const values = positionValues(book, 115_00);
    expect(values).toEqual({
      netQty: 15,
      buyQty: 20,
      sellQty: 5,
      avgBuyPrice: 105_00,
      avgSellPrice: 120_00,
      avgPrice: 105_00,
      ltp: 115_00,
      realisedPnl: 75_00,
      unrealisedPnl: 150_00,
      dayPnl: 225_00,
    });
    const position = { token: 2885, symbol: 'RELIANCE', exchange: 'NSE', product: 'INTRADAY' };
    // Position has no avgPrice or dayPnl; the schema strips them and accepts the rest.
    expect(Position.parse({ ...position, ...values })).toMatchObject({
      ...position,
      netQty: 15,
      realisedPnl: 75_00,
      unrealisedPnl: 150_00,
    });
    expect(positionValues(EMPTY_POSITION, 100_00)).toMatchObject({
      avgBuyPrice: 0,
      avgSellPrice: 0,
    });
  });

  it('keeps realised + unrealised equal to cash flow plus mark for any trade sequence', () => {
    let seed = 12_345;
    const next = () => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed / 4_294_967_296;
    };
    let book = EMPTY_POSITION;
    for (let i = 0; i < 500; i += 1) {
      const side = next() < 0.5 ? 'BUY' : 'SELL';
      const trade: Trade = {
        side,
        qty: 1 + Math.floor(next() * 50),
        price: 5 * (1 + Math.floor(next() * 40_000)),
      };
      book = applyTrade(book, trade);
      const ltp = 5 * (1 + Math.floor(next() * 40_000));
      expect(book.realisedPnl + unrealisedPnl(book, ltp)).toBe(
        book.sellValue - book.buyValue + book.netQty * ltp,
      );
      expect(book.openCost).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects floats and bad quantities', () => {
    expect(() => applyTrade(EMPTY_POSITION, buy(1, 100.5))).toThrow(/integer number of paise/);
    expect(() => applyTrade(EMPTY_POSITION, buy(0, 100_00))).toThrow(/at least 1/);
    expect(() => applyTrade(EMPTY_POSITION, buy(1.5, 100_00))).toThrow(RangeError);
    expect(() => unrealisedPnl(EMPTY_POSITION, 0)).toThrow(/positive/);
    expect(() => applyTrade(EMPTY_POSITION, buy(2 ** 40, 2 ** 20))).toThrow(/Trade value/);
  });
});

describe('holding math (T-067)', () => {
  it('values a holding: invested, current, P&L and day change', () => {
    // 20 shares at ₹105 average; yesterday closed ₹112, now ₹115.
    const values = holdingValues({ qty: 20, investedValue: 2_100_00 }, 115_00, 112_00);
    expect(values).toEqual({
      qty: 20,
      avgPrice: 105_00,
      ltp: 115_00,
      investedValue: 2_100_00,
      currentValue: 2_300_00,
      pnl: 200_00,
      pnlBp: 952, // 9.52%
      dayChange: 60_00,
      dayChangeBp: 268, // 2.68%
    });
    const holding = { token: 2885, symbol: 'RELIANCE', exchange: 'NSE', ...values };
    expect(Holding.parse(holding)).toEqual(holding);
  });

  it('reports a falling day as a negative day change', () => {
    const values = holdingValues({ qty: 3, investedValue: 300_00 }, 95_00, 100_00);
    expect(values).toMatchObject({
      pnl: -15_00,
      pnlBp: -500,
      dayChange: -15_00,
      dayChangeBp: -500,
    });
  });

  it('rejects bad input', () => {
    expect(() => holdingValues({ qty: 0, investedValue: 0 }, 1_00, 1_00)).toThrow(/at least 1/);
    expect(() => holdingValues({ qty: 1, investedValue: -1 }, 1_00, 1_00)).toThrow(/negative/);
    expect(() => holdingValues({ qty: 1, investedValue: 1_00 }, 0, 1_00)).toThrow(/LTP/);
    expect(() => holdingValues({ qty: 1, investedValue: 1_00 }, 1_00, 0)).toThrow(/Previous close/);
  });
});

describe('rounding helpers', () => {
  it('rounds half away from zero, exactly, beyond 2^53 intermediates', () => {
    expect(mulDivRound(5, 1, 2)).toBe(3);
    expect(mulDivRound(-5, 1, 2)).toBe(-3);
    expect(mulDivRound(4, 1, 3)).toBe(1);
    expect(mulDivRound(-4, 1, 3)).toBe(-1);
    expect(mulDivRound(9_000_000_000_000, 9_000, 9_000)).toBe(9_000_000_000_000);
    expect(() => mulDivRound(1, 1, 0)).toThrow(/positive/);
    expect(basisPoints(1, 0)).toBe(0);
    expect(basisPoints(1, 3)).toBe(3_333);
  });
});
