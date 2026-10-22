import { TRAILING_STOP_MESSAGES } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { attachPlan, initialAttachState, replacesStop, type AttachState } from './attachedStop';
import type { TicketFormValues } from './ticketForm';
import {
  attachedDirection,
  attachedPreviewText,
  attachedReviewSentence,
  defaultTrailingValues,
  toAttachedParams,
  type TrailingFormValues,
} from './trailingStopForm';

const LTP = 150_000; // ₹1,500.00
const trailing = (extra: Partial<TrailingFormValues>): TrailingFormValues => ({
  ...defaultTrailingValues('DELIVERY'),
  ...extra,
});
const ticket = (extra: Partial<TicketFormValues> = {}): TicketFormValues => ({
  side: 'BUY',
  type: 'MARKET',
  product: 'DELIVERY',
  qty: 10,
  price: null,
  ...extra,
});
const on = (values: Partial<TrailingFormValues>): AttachState => ({
  enabled: true,
  values: trailing(values),
  touched: false,
});

describe('"Add trailing stop" on an entry (T14, SPEC-TFC-1 §6.4, §7)', () => {
  it('protects a long for a buy and a short for an Intraday sell; a Delivery sell has none', () => {
    expect(attachedDirection('BUY', 'DELIVERY')).toBe('LONG');
    expect(attachedDirection('BUY', 'INTRADAY')).toBe('LONG');
    expect(attachedDirection('SELL', 'INTRADAY')).toBe('SHORT');
    expect(attachedDirection('SELL', 'DELIVERY')).toBeNull();
  });

  it('is unavailable without trailing stops, and not offered on a Delivery sell', () => {
    const state = on({ value: 150 });
    expect(attachPlan(ticket(), state, { trailingAvailable: false, ltp: LTP })).toMatchObject({
      status: 'unavailable',
      attaching: false,
    });
    expect(
      attachPlan(ticket({ side: 'SELL' }), state, { trailingAvailable: true, ltp: LTP }),
    ).toMatchObject({ status: 'notForSale', attaching: false });
    expect(
      attachPlan(ticket(), initialAttachState(), { trailingAvailable: true, ltp: LTP }),
    ).toMatchObject({ status: 'available', attaching: false, check: { ok: true } });
  });

  it('checks the stop against the limit price, or the LTP for a market order', () => {
    const plan = attachPlan(ticket({ type: 'LIMIT', price: 148_000 }), on({ value: 150 }), {
      trailingAvailable: true,
      ltp: LTP,
    });
    expect(plan).toMatchObject({ attaching: true, refPrice: 148_000, check: { ok: true } });
    expect(
      attachPlan(ticket(), on({ value: null }), { trailingAvailable: true, ltp: LTP }).check,
    ).toEqual({ ok: false, field: 'value', message: TRAILING_STOP_MESSAGES.trailNotPositive });
    expect(
      attachPlan(ticket(), on({ value: 2_500 }), { trailingAvailable: true, ltp: LTP }).check,
    ).toEqual({
      ok: false,
      field: 'value',
      message: TRAILING_STOP_MESSAGES.trailPercentOutOfRange,
    });
  });

  it('previews rupee, percent, activation and short stops for the expected fill', () => {
    expect(attachedPreviewText(trailing({ value: 150 }), LTP, 'LONG')).toBe(
      'If the entry fills at ₹1,500.00: initial stop ₹1,477.50, trails 1.5% below the high',
    );
    expect(attachedPreviewText(trailing({ unit: 'AMOUNT', value: 2_000 }), LTP, 'LONG')).toBe(
      'If the entry fills at ₹1,500.00: initial stop ₹1,480.00, trails ₹20.00 below the high',
    );
    expect(
      attachedPreviewText(trailing({ value: 150, activationPrice: 152_000 }), LTP, 'LONG'),
    ).toBe(
      'If the entry fills at ₹1,500.00: initial stop ₹1,497.20, trails 1.5% below the high (activates at ₹1,520.00)',
    );
    expect(attachedPreviewText(trailing({ value: 150 }), LTP, 'SHORT')).toBe(
      'If the entry fills at ₹1,500.00: initial stop ₹1,522.50, trails 1.5% above the low',
    );
    expect(attachedPreviewText(trailing({ value: 150 }), null, 'LONG')).toBeNull();
  });

  it('restates the stop in one sentence for the review, and sends its params', () => {
    expect(attachedReviewSentence(trailing({ value: 150 }), 'LONG')).toBe(
      'Once the entry fills, exits with a market order when the price falls from its high by 1.5%. The stop starts from your fill price and only ever tightens.',
    );
    expect(
      attachedReviewSentence(
        trailing({ value: 150, exitOrderType: 'LIMIT', exitLimitOffset: 50 }),
        'SHORT',
      ),
    ).toContain('a limit order ₹0.50 beyond the stop when the price rises from its low by 1.5%');
    expect(toAttachedParams(trailing({ value: 150 }))).toEqual({
      trail: { unit: 'PERCENT', basisPoints: 150 },
      activationPrice: null,
      exitOrderType: 'MARKET',
      exitLimitOffset: null,
    });
    expect(toAttachedParams(trailing({ value: null }))).toBeNull();
  });

  it('replaces the stop of a position it adds to, same product and direction', () => {
    const stops = [{ product: 'DELIVERY' as const, direction: 'LONG' as const }];
    expect(replacesStop(stops, { product: 'DELIVERY' }, 'LONG')).toBe(true);
    expect(replacesStop(stops, { product: 'INTRADAY' }, 'LONG')).toBe(false);
    expect(replacesStop(stops, { product: 'DELIVERY' }, 'SHORT')).toBe(false);
  });
});
