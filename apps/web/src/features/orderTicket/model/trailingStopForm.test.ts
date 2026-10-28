import { TRAILING_STOP_MESSAGES, type Position } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkTrailing,
  defaultTrailingValues,
  openPositions,
  previewText,
  reviewSentence,
  toPlaceTrailingStopRequest,
  trailText,
  type TrailingFormValues,
} from './trailingStopForm';

const position = (netQty: number, product: Position['product'] = 'DELIVERY'): Position => ({
  token: 8,
  symbol: 'INFY',
  exchange: 'NSE',
  product,
  netQty,
  buyQty: Math.max(netQty, 0),
  sellQty: Math.max(-netQty, 0),
  avgBuyPrice: 150_000,
  avgSellPrice: 0,
  ltp: 150_000,
  realisedPnl: 0,
  unrealisedPnl: 0,
});

const values = (extra: Partial<TrailingFormValues>): TrailingFormValues => ({
  ...defaultTrailingValues('DELIVERY'),
  ...extra,
});

const LTP = 150_000; // ₹1,500.00
const long = { position: position(10), ltp: LTP };

describe('Trailing stop ticket rules (T13, SPEC-TFC-1 §6.6)', () => {
  it('shows each §6.6 message, word for word', () => {
    expect(checkTrailing(values({ value: 150 }), { position: undefined, ltp: LTP })).toEqual({
      ok: false,
      field: 'form',
      message: TRAILING_STOP_MESSAGES.noPosition,
    });
    expect(checkTrailing(values({ value: null }), long)).toMatchObject({
      field: 'value',
      message: 'Enter a trail greater than zero.',
    });
    expect(checkTrailing(values({ value: 0 }), long)).toMatchObject({
      message: 'Enter a trail greater than zero.',
    });
    expect(checkTrailing(values({ unit: 'AMOUNT', value: 3 }), long)).toMatchObject({
      message: 'The trail must be at least ₹0.05.',
    });
    expect(checkTrailing(values({ unit: 'AMOUNT', value: 30_005 }), long)).toMatchObject({
      message: 'The trail can be at most 20% of the price (₹300.00).',
    });
    for (const basisPoints of [5, 2_001]) {
      expect(checkTrailing(values({ value: basisPoints }), long)).toMatchObject({
        message: 'Enter a trail between 0.10% and 20%.',
      });
    }
    expect(
      checkTrailing(values({ value: 1_000, exitOrderType: 'LIMIT', exitLimitOffset: null }), long),
    ).toMatchObject({ field: 'exitLimitOffset', message: 'Enter a limit offset' });
    expect(
      checkTrailing(
        values({ value: 1_000, exitOrderType: 'LIMIT', exitLimitOffset: 140_000 }),
        long,
      ),
    ).toMatchObject({
      field: 'exitLimitOffset',
      message: 'The limit offset is too large for this stop.',
    });
    expect(checkTrailing(values({ value: 150 }), long)).toEqual({ ok: true });
  });

  it('offers only open positions in the instrument', () => {
    const flat = { ...position(0, 'INTRADAY') };
    const other = { ...position(5), token: 9 };
    expect(openPositions([position(10), flat, other], 8).map((p) => p.product)).toEqual([
      'DELIVERY',
    ]);
  });

  it('previews the initial stop the engine will set, for each case', () => {
    expect(trailText({ unit: 'PERCENT', basisPoints: 150 })).toBe('1.5%');
    expect(trailText({ unit: 'AMOUNT', amount: 1_250 })).toBe('₹12.50');
    expect(previewText(values({ value: 150 }), LTP, 'LONG')).toBe(
      'Initial stop ₹1,477.50, trails 1.5% below the high',
    );
    expect(previewText(values({ unit: 'AMOUNT', value: 1_000 }), LTP, 'SHORT')).toBe(
      'Initial stop ₹1,510.00, trails ₹10.00 above the low',
    );
    expect(previewText(values({ value: 150, activationPrice: 152_000 }), LTP, 'LONG')).toBe(
      'Initial stop ₹1,497.20, trails 1.5% below the high (activates at ₹1,520.00)',
    );
    expect(previewText(values({ value: 150, activationPrice: 149_000 }), LTP, 'LONG')).toBe(
      'Initial stop ₹1,477.50, trails 1.5% below the high (activates immediately)',
    );
    expect(previewText(values({ value: null }), LTP, 'LONG')).toBeNull();
    expect(previewText(values({ value: 150 }), null, 'LONG')).toBeNull();
  });

  it('restates the behaviour in one sentence for the review', () => {
    expect(reviewSentence(values({ value: 150 }), position(10), 'INFY')).toBe(
      'Sell 10 INFY with a market order when the price falls from its high by 1.5%. The stop only ever tightens.',
    );
    expect(
      reviewSentence(
        values({ unit: 'AMOUNT', value: 500, exitOrderType: 'LIMIT', exitLimitOffset: 50 }),
        position(-4, 'INTRADAY'),
        'INFY',
      ),
    ).toBe(
      'Buy 4 INFY with a limit order ₹0.50 beyond the stop when the price rises from its low by ₹5.00. The stop only ever tightens.',
    );
  });

  it('builds the request, without an offset for a market exit', () => {
    expect(toPlaceTrailingStopRequest(values({ value: 150, exitLimitOffset: 5 }), 8)).toEqual({
      token: 8,
      product: 'DELIVERY',
      trail: { unit: 'PERCENT', basisPoints: 150 },
      activationPrice: null,
      exitOrderType: 'MARKET',
      exitLimitOffset: null,
    });
    expect(() => toPlaceTrailingStopRequest(values({ value: null }), 8)).toThrow();
  });
});
