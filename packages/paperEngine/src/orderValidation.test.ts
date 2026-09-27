import { fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import type { InstrumentInfo } from './instruments.js';
import {
  intradayWindowOpen,
  isRequestError,
  validateOrder,
  type OrderDraft,
  type OrderRejectionCode,
  type ValidationContext,
} from './orderValidation.js';

const INFY: InstrumentInfo = {
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  lowerCircuit: 1_200_00,
  upperCircuit: 1_800_00,
};

// Friday 25 Sep 2026 is a trading day; Saturday 26 is not; Monday 14 Sep 2026 is Ganesh Chaturthi.
const ist = (hour: number, minute: number, day = 25, month = 9) =>
  fromIst(2026, month, day, hour * 60 + minute);

const buy: OrderDraft = {
  token: INFY.token,
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 10,
  price: 1_500_00,
};
const ctx: ValidationContext = {
  now: ist(10, 0),
  instrument: INFY,
  ltp: 1_500_00,
  availableCash: 10_00_000_00,
  sellableQty: 0,
};

describe('validateOrder (T-127): each rule has a plain-language reason', () => {
  const cases: {
    rule: string;
    order?: Partial<OrderDraft>;
    ctx?: Partial<ValidationContext>;
    code: OrderRejectionCode;
    reason: RegExp;
  }[] = [
    {
      rule: 'qty 0',
      order: { qty: 0 },
      code: 'INVALID_QTY',
      reason: /whole number of shares, at least 1/,
    },
    { rule: 'qty negative', order: { qty: -5 }, code: 'INVALID_QTY', reason: /at least 1/ },
    { rule: 'qty fractional', order: { qty: 1.5 }, code: 'INVALID_QTY', reason: /whole number/ },
    { rule: 'qty NaN', order: { qty: Number.NaN }, code: 'INVALID_QTY', reason: /whole number/ },
    {
      rule: 'LIMIT without a price',
      order: { price: null },
      code: 'PRICE_REQUIRED',
      reason: /Enter a limit price/,
    },
    {
      rule: 'MARKET with a price',
      order: { type: 'MARKET', price: 1_500_00 },
      code: 'PRICE_NOT_ALLOWED',
      reason: /market order has no price/,
    },
    {
      rule: 'price off the 5-paise tick',
      order: { price: 1_500_03 },
      code: 'PRICE_OFF_TICK',
      reason: /multiple of 5 paise/,
    },
    {
      rule: 'price in fractional paise',
      order: { price: 1_500_00.5 },
      code: 'PRICE_OFF_TICK',
      reason: /multiple of 5 paise/,
    },
    {
      rule: 'price zero',
      order: { price: 0 },
      code: 'PRICE_OFF_TICK',
      reason: /positive multiple/,
    },
    {
      rule: 'unknown instrument',
      ctx: { instrument: null },
      code: 'UNKNOWN_INSTRUMENT',
      reason: /not available to trade/,
    },
    {
      rule: 'intraday before 9:15',
      order: { product: 'INTRADAY' },
      ctx: { now: ist(9, 10) },
      code: 'INTRADAY_MARKET_CLOSED',
      reason: /only while the market is open, 9:15 AM to 3:20 PM IST/,
    },
    {
      rule: 'intraday at the 15:20 square-off',
      order: { product: 'INTRADAY' },
      ctx: { now: ist(15, 20) },
      code: 'INTRADAY_MARKET_CLOSED',
      reason: /Choose Delivery/,
    },
    {
      rule: 'intraday in the evening',
      order: { product: 'INTRADAY', side: 'SELL' },
      ctx: { now: ist(20, 0) },
      code: 'INTRADAY_MARKET_CLOSED',
      reason: /market is open/,
    },
    {
      rule: 'intraday on a Saturday',
      order: { product: 'INTRADAY' },
      ctx: { now: ist(11, 0, 26) },
      code: 'INTRADAY_MARKET_CLOSED',
      reason: /market is open/,
    },
    {
      rule: 'intraday on an NSE holiday',
      order: { product: 'INTRADAY' },
      ctx: { now: ist(11, 0, 14) },
      code: 'INTRADAY_MARKET_CLOSED',
      reason: /market is open/,
    },
    {
      rule: 'MARKET with no price yet',
      order: { type: 'MARKET', price: null },
      ctx: { ltp: null },
      code: 'NO_PRICE',
      reason: /no market price for INFY yet/,
    },
    {
      rule: 'LIMIT above the upper circuit',
      order: { price: 1_800_05 },
      code: 'OUTSIDE_CIRCUIT',
      reason: /₹1,800.05 is outside today's range for INFY: ₹1,200.00 to ₹1,800.00/,
    },
    {
      rule: 'LIMIT below the lower circuit',
      order: { price: 1_199_95, side: 'SELL' },
      code: 'OUTSIDE_CIRCUIT',
      reason: /outside today's range/,
    },
    {
      rule: 'order value beyond safe integers',
      order: { qty: 2 ** 50 },
      code: 'ORDER_TOO_LARGE',
      reason: /too large/,
    },
    {
      rule: 'delivery SELL with no holdings',
      order: { side: 'SELL' },
      code: 'INSUFFICIENT_HOLDINGS',
      reason: /You have no INFY shares to sell for delivery/,
    },
    {
      rule: 'delivery SELL beyond holdings',
      order: { side: 'SELL' },
      ctx: { sellableQty: 4 },
      code: 'INSUFFICIENT_HOLDINGS',
      reason: /You can sell up to 4 INFY shares for delivery; this order is for 10/,
    },
    {
      rule: 'BUY beyond available cash',
      ctx: { availableCash: 14_999_99 },
      code: 'INSUFFICIENT_FUNDS',
      reason: /Not enough cash: this order needs ₹15,000.00 and ₹14,999.99 is available/,
    },
    {
      rule: 'MARKET BUY valued at LTP beyond cash',
      order: { type: 'MARKET', price: null },
      ctx: { ltp: 1_600_00, availableCash: 15_000_00 },
      code: 'INSUFFICIENT_FUNDS',
      reason: /needs ₹16,000.00/,
    },
    {
      rule: 'BUY with overdrawn cash shows ₹0 available',
      ctx: { availableCash: -5_00 },
      code: 'INSUFFICIENT_FUNDS',
      reason: /₹0.00 is available/,
    },
  ];

  it.each(cases)('rejects $rule', ({ order, ctx: overrides, code, reason }) => {
    const result = validateOrder({ ...buy, ...order }, { ...ctx, ...overrides });
    expect(result).toMatchObject({ ok: false, code });
    if (result.ok) return;
    expect(result.reason).toMatch(reason);
    // Plain language: a full sentence, no codes or field names.
    expect(result.reason).toMatch(/^[A-Z].*\.$/);
    expect(result.reason).not.toMatch(/[A-Z]+_[A-Z]+/);
  });

  const accepted: {
    rule: string;
    order?: Partial<OrderDraft>;
    ctx?: Partial<ValidationContext>;
    blockAmount: number;
  }[] = [
    {
      rule: 'a LIMIT BUY with exactly enough cash',
      ctx: { availableCash: 15_000_00 },
      blockAmount: 15_000_00,
    },
    {
      rule: 'a MARKET BUY valued at LTP',
      order: { type: 'MARKET', price: null },
      blockAmount: 15_000_00,
    },
    {
      rule: 'a LIMIT at the upper circuit',
      order: { price: 1_800_00, qty: 1 },
      blockAmount: 1_800_00,
    },
    {
      rule: 'a LIMIT at the lower circuit',
      order: { price: 1_200_00, qty: 1 },
      blockAmount: 1_200_00,
    },
    {
      rule: 'a delivery SELL of all holdings',
      order: { side: 'SELL' },
      ctx: { sellableQty: 10 },
      blockAmount: 0,
    },
    {
      rule: 'an intraday SELL (short) with no holdings',
      order: { side: 'SELL', product: 'INTRADAY' },
      blockAmount: 0,
    },
    {
      rule: 'intraday at 9:15',
      order: { product: 'INTRADAY' },
      ctx: { now: ist(9, 15) },
      blockAmount: 15_000_00,
    },
    {
      rule: 'intraday at 15:19',
      order: { product: 'INTRADAY' },
      ctx: { now: ist(15, 19) },
      blockAmount: 15_000_00,
    },
    {
      rule: 'a delivery order in the evening (AMO)',
      ctx: { now: ist(20, 0) },
      blockAmount: 15_000_00,
    },
    {
      rule: 'a delivery order on a Saturday (AMO)',
      ctx: { now: ist(11, 0, 26) },
      blockAmount: 15_000_00,
    },
  ];

  it.each(accepted)('accepts $rule', ({ order, ctx: overrides, blockAmount }) => {
    expect(validateOrder({ ...buy, ...order }, { ...ctx, ...overrides })).toEqual({
      ok: true,
      blockAmount,
    });
  });

  it('checks the rules in a fixed order, reporting the first failure', () => {
    const everythingWrong = validateOrder(
      { ...buy, qty: 0, price: 1_500_03 },
      { ...ctx, instrument: null, availableCash: 0 },
    );
    expect(everythingWrong).toMatchObject({ code: 'INVALID_QTY' });
    const poorAndOutOfBand = validateOrder(
      { ...buy, price: 1_900_00 },
      { ...ctx, availableCash: 0 },
    );
    expect(poorAndOutOfBand).toMatchObject({ code: 'OUTSIDE_CIRCUIT' });
  });

  it('can use another holiday table', () => {
    const everyDayOff = new Proxy({}, { get: () => 'Closed' });
    const result = validateOrder(
      { ...buy, product: 'INTRADAY' },
      { ...ctx, holidays: everyDayOff },
    );
    expect(result).toMatchObject({ code: 'INTRADAY_MARKET_CLOSED' });
  });
});

describe('isRequestError', () => {
  it('separates malformed requests from risk rejections', () => {
    expect(isRequestError('INVALID_QTY')).toBe(true);
    expect(isRequestError('PRICE_OFF_TICK')).toBe(true);
    expect(isRequestError('UNKNOWN_INSTRUMENT')).toBe(true);
    expect(isRequestError('INSUFFICIENT_FUNDS')).toBe(false);
    expect(isRequestError('OUTSIDE_CIRCUIT')).toBe(false);
  });
});

describe('intradayWindowOpen', () => {
  it.each([
    [ist(9, 14), false],
    [ist(9, 15), true],
    [ist(15, 19), true],
    [ist(15, 20), false],
    [ist(15, 30), false],
    [ist(10, 0, 26), false],
  ])('%s → %s', (now, open) => {
    expect(intradayWindowOpen(now)).toBe(open);
  });
});
