import type { Position, TrailingStop } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { livePosition } from '@/features/positions';
import { activationLine, positionLine, stopLine, stopTriggersNow } from './positionLines';

const long: Position = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'DELIVERY',
  netQty: 10,
  buyQty: 10,
  sellQty: 0,
  avgBuyPrice: 123_450,
  avgSellPrice: 0,
  ltp: 123_450,
  realisedPnl: 0,
  unrealisedPnl: 0,
};
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
  trail: { unit: 'PERCENT', basisPoints: 150 },
  stopPrice: 122_840,
  ...extra,
});

describe('position line (T18, SPEC-TFC-1 §8.1)', () => {
  it('sits at the average with the quantity and a P&L that follows the price', () => {
    const at = (ltp: number) => positionLine(livePosition(long, ltp), null);
    expect(at(124_650)).toMatchObject({
      id: 'position:DELIVERY',
      price: 123_450,
      tone: 'position',
      label: '+10 @ ₹1,234.50 · +₹120.00',
      draggable: false,
    });
    expect(at(123_000)?.label).toBe('+10 @ ₹1,234.50 · -₹45.00');
    expect(at(124_650)?.description).toBe(
      'Long 10 shares at ₹1,234.50, P&L +₹120.00. Open to set a trailing stop.',
    );
  });

  it('says a short is short, and shows a stop that has no line yet on the chip', () => {
    const short = {
      ...long,
      netQty: -5,
      buyQty: 0,
      sellQty: 5,
      avgBuyPrice: 0,
      avgSellPrice: 123_450,
    };
    const line = positionLine(
      livePosition(short, 123_450),
      stop({ status: 'ARMED', stopPrice: null }),
    );
    expect(line?.label).toBe('-5 @ ₹1,234.50 · ₹0.00 · Trailing stop armed');
    expect(line?.description).toMatch(
      /^Short 5 shares .* Trailing stop: Armed\. Open to change it\.$/,
    );
  });
});

describe('trailing-stop line (§8.1)', () => {
  it('is drawn at the stop while trailing or triggered, with its trail and status', () => {
    expect(stopLine(stop())).toMatchObject({
      id: 'stop:ts_1',
      price: 122_840,
      tone: 'trailing',
      label: 'Trailing stop ₹1,228.40 · 1.5% · Trailing',
      draggable: true,
    });
    expect(stopLine(stop({ trail: { unit: 'AMOUNT', amount: 1_250 } }))?.label).toBe(
      'Trailing stop ₹1,228.40 · ₹12.50 · Trailing',
    );
    expect(stopLine(stop({ status: 'TRIGGERED' }))?.label).toMatch(/· Triggered$/);
  });

  it('has no line while waiting for entry or armed', () => {
    expect(stopLine(stop({ status: 'ARMED', stopPrice: null }))).toBeNull();
    expect(stopLine(stop({ status: 'PENDING_ENTRY', stopPrice: null }))).toBeNull();
  });
});

describe('moving the trailing stop (T19, SPEC-TFC-1 §6.5, §6.6)', () => {
  it('can be dragged only while trailing; it follows the finger, then reads Saving…', () => {
    expect(stopLine(stop({ status: 'TRIGGERED' }))?.draggable).toBe(false);
    expect(stopLine(stop(), { price: 123_000, phase: 'dragging' })).toMatchObject({
      price: 123_000,
      tone: 'trailing',
      label: 'Trailing stop ₹1,230.00 · 1.5% · Trailing',
      draggable: true,
    });
    expect(stopLine(stop(), { price: 123_000, phase: 'sending' })).toMatchObject({
      price: 123_000,
      tone: 'pending',
      label: 'Saving… ₹1,230.00',
      draggable: false,
    });
  });

  it('refuses a stop at or through the price: below it for a long, above it for a short', () => {
    expect(stopTriggersNow('LONG', 150_000, 149_995)).toBe(false);
    expect(stopTriggersNow('LONG', 150_000, 150_000)).toBe(true);
    expect(stopTriggersNow('SHORT', 150_000, 150_005)).toBe(false);
    expect(stopTriggersNow('SHORT', 150_000, 149_995)).toBe(true);
    expect(stopTriggersNow('LONG', undefined, 160_000)).toBe(false);
  });

  it('draws the activation price of a stop waiting to trail as a dotted line', () => {
    expect(
      activationLine(stop({ status: 'ARMED', stopPrice: null, activationPrice: 156_000 })),
    ).toMatchObject({
      id: 'activation:ts_1',
      price: 156_000,
      tone: 'activation',
      label: 'Activates at ₹1,560.00',
      draggable: false,
    });
    expect(activationLine(stop({ status: 'ARMED', stopPrice: null }))).toBeNull();
    expect(activationLine(stop({ activationPrice: 156_000 }))).toBeNull();
  });
});
