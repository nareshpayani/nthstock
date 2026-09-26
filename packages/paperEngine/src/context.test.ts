import { fixedClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import {
  assertPaise,
  assertQty,
  createEngineContext,
  createMapPriceSource,
  createSequentialIds,
} from './context.js';

const RELIANCE = 2885;

describe('createEngineContext (T-064)', () => {
  it('reads time only from the injected clock', () => {
    const ctx = createEngineContext({
      clock: fixedClock('2026-09-25T04:00:00Z'),
      prices: createMapPriceSource(),
    });
    expect(ctx.now().toISOString()).toBe('2026-09-25T04:00:00.000Z');
    expect(ctx.nowIso()).toBe('2026-09-25T04:00:00.000Z');
  });

  it('reads prices only from the injected price source', () => {
    const prices = createMapPriceSource([[RELIANCE, 1_234_50]]);
    const ctx = createEngineContext({ clock: fixedClock(0), prices });
    expect(ctx.ltp(RELIANCE)).toBe(1_234_50);
    prices.set(RELIANCE, 1_240_00);
    expect(ctx.ltp(RELIANCE)).toBe(1_240_00);
    prices.delete(RELIANCE);
    expect(ctx.ltp(RELIANCE)).toBeNull();
    expect(ctx.ltp(1)).toBeNull();
  });

  it('refuses a float or non-positive price from the source', () => {
    const ctx = createEngineContext({ clock: fixedClock(0), prices: { getLtp: () => 100.5 } });
    expect(() => ctx.ltp(RELIANCE)).toThrow(RangeError);
    const zero = createEngineContext({ clock: fixedClock(0), prices: { getLtp: () => 0 } });
    expect(() => zero.ltp(RELIANCE)).toThrow(/positive/);
    expect(() => createMapPriceSource([[RELIANCE, 99.99]])).toThrow(RangeError);
  });

  it('issues deterministic ids, or uses the injected generator', () => {
    const ctx = createEngineContext({ clock: fixedClock(0), prices: createMapPriceSource() });
    expect([ctx.nextId(), ctx.nextId()]).toEqual(['pe1', 'pe2']);
    const ids = createSequentialIds('ord_');
    const custom = createEngineContext({
      clock: fixedClock(0),
      prices: createMapPriceSource(),
      nextId: ids,
    });
    expect(custom.nextId()).toBe('ord_1');
  });
});

describe('guards', () => {
  it('accepts integer paise and whole quantities only', () => {
    expect(() => assertPaise(-500, 'P&L')).not.toThrow();
    expect(() => assertPaise(0.1, 'amount')).toThrow(/integer number of paise/);
    expect(() => assertQty(1, 'qty')).not.toThrow();
    expect(() => assertQty(0, 'qty')).toThrow(/at least 1/);
    expect(() => assertQty(1.5, 'qty')).toThrow(RangeError);
  });
});
