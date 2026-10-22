import type { TrailingStop } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAIL_BP,
  defaultTrailValue,
  isActiveStop,
  isChangeableStop,
  sheetValues,
  toTrailModify,
} from './trailingSheet';

const BASE_STOP: TrailingStop = {
  id: 'ts_1',
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'DELIVERY',
  direction: 'LONG',
  trail: { unit: 'AMOUNT', amount: 1_250 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
  status: 'TRAILING',
  statusReason: null,
  watermarkPrice: 153_540,
  stopPrice: 152_290,
  protectedQty: 10,
  entryOrderId: null,
  exitOrderId: null,
  seq: 1,
  createdAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
};
const stop = (extra: Partial<TrailingStop> = {}): TrailingStop => ({
  ...BASE_STOP,
  ...extra,
});

describe('trailing-stop sheet values (T18, SPEC-TFC-1 §8.4)', () => {
  it('defaults to a 1.0% trail, or 1% of the LTP in rupees on the ₹0.05 tick', () => {
    expect(DEFAULT_TRAIL_BP).toBe(100);
    expect(defaultTrailValue('PERCENT', null)).toBe(100);
    expect(defaultTrailValue('AMOUNT', 152_340)).toBe(1_525);
    expect(defaultTrailValue('AMOUNT', 200)).toBe(5);
    expect(defaultTrailValue('AMOUNT', null)).toBeNull();
  });

  it('starts a new stop at 1.0% with a market exit, and an existing one at its own terms', () => {
    expect(sheetValues(null, 'INTRADAY')).toMatchObject({
      product: 'INTRADAY',
      unit: 'PERCENT',
      value: 100,
      exitOrderType: 'MARKET',
    });
    expect(sheetValues(stop(), 'INTRADAY')).toEqual({
      product: 'DELIVERY',
      unit: 'AMOUNT',
      value: 1_250,
      activationPrice: null,
      exitOrderType: 'MARKET',
      exitLimitOffset: null,
    });
    // A finished stop is gone: the sheet sets a new one.
    expect(sheetValues(stop({ status: 'CANCELLED' }), 'DELIVERY').value).toBe(100);
  });

  it('knows which stops can still change', () => {
    expect(isActiveStop(null)).toBe(false);
    expect(isActiveStop(stop({ status: 'EXECUTED' }))).toBe(false);
    expect(isChangeableStop(stop({ status: 'ARMED' }))).toBe(true);
    expect(isChangeableStop(stop({ status: 'TRIGGERED' }))).toBe(false);
  });

  it('updates only a changed trail', () => {
    expect(toTrailModify({ unit: 'AMOUNT', value: 1_250 }, stop())).toBeNull();
    expect(toTrailModify({ unit: 'AMOUNT', value: null }, stop())).toBeNull();
    expect(toTrailModify({ unit: 'AMOUNT', value: 1_500 }, stop())).toEqual({
      trail: { unit: 'AMOUNT', amount: 1_500 },
    });
    expect(toTrailModify({ unit: 'PERCENT', value: 125 }, stop())).toEqual({
      trail: { unit: 'PERCENT', basisPoints: 125 },
    });
  });
});
