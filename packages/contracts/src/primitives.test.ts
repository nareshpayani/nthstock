import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorFixture } from './fixtures.js';
import {
  ApiError,
  BasisPoints,
  CursorQuery,
  Exchange,
  Id,
  InstrumentToken,
  IsoUtc,
  OkResponse,
  Paise,
  TickPrice,
  TradingSymbol,
  cursorPage,
} from './primitives.js';

describe('Paise', () => {
  it('accepts integer paise, including negatives and zero', () => {
    for (const value of [0, 5, -1_255, 10_00_000_00]) {
      expect(Paise.parse(value)).toBe(value);
    }
  });

  it('rejects float paise', () => {
    expect(Paise.safeParse(1523.45).success).toBe(false);
    expect(Paise.safeParse(0.5).success).toBe(false);
  });

  it('rejects unsafe integers, NaN and strings', () => {
    expect(Paise.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(Paise.safeParse(Number.NaN).success).toBe(false);
    expect(Paise.safeParse('100').success).toBe(false);
  });
});

describe('TickPrice', () => {
  it('accepts positive multiples of 5 paise', () => {
    expect(TickPrice.parse(152_345)).toBe(152_345);
  });

  it('rejects off-tick, zero and negative prices', () => {
    const offTick = TickPrice.safeParse(152_343);
    expect(offTick.success).toBe(false);
    expect(offTick.error?.issues[0]?.message).toBe('Price must be a multiple of 5 paise');
    expect(TickPrice.safeParse(0).success).toBe(false);
    expect(TickPrice.safeParse(-5).success).toBe(false);
  });
});

describe('BasisPoints', () => {
  it('accepts integers and rejects fractions', () => {
    expect(BasisPoints.parse(-82)).toBe(-82);
    expect(BasisPoints.safeParse(0.82).success).toBe(false);
  });
});

describe('TradingSymbol', () => {
  it('accepts NSE-style symbols', () => {
    for (const symbol of ['INFY', 'M&M', 'BAJAJ-AUTO', 'NIFTY50', 'A', 'ABCDEFGHIJKLMNOPQRST']) {
      expect(TradingSymbol.parse(symbol)).toBe(symbol);
    }
  });

  it('rejects lowercase symbols', () => {
    expect(TradingSymbol.safeParse('infy').success).toBe(false);
    expect(TradingSymbol.safeParse('Infy').success).toBe(false);
  });

  it('rejects empty, too long and other characters', () => {
    for (const symbol of ['', 'ABCDEFGHIJKLMNOPQRSTU', 'NIFTY 50', 'INFY.NS']) {
      expect(TradingSymbol.safeParse(symbol).success).toBe(false);
    }
  });
});

describe('Exchange', () => {
  it('is NSE or BSE only', () => {
    expect(Exchange.options).toEqual(['NSE', 'BSE']);
    expect(Exchange.safeParse('MCX').success).toBe(false);
  });
});

describe('IsoUtc', () => {
  it('accepts UTC timestamps ending in Z', () => {
    expect(IsoUtc.parse('2026-09-25T03:45:00Z')).toBe('2026-09-25T03:45:00Z');
    expect(IsoUtc.parse('2026-09-25T03:45:00.123Z')).toBe('2026-09-25T03:45:00.123Z');
  });

  it('rejects offsets, local times and dates', () => {
    for (const value of ['2026-09-25T09:15:00+05:30', '2026-09-25T09:15:00', '2026-09-25']) {
      expect(IsoUtc.safeParse(value).success).toBe(false);
    }
  });
});

describe('InstrumentToken and Id', () => {
  it('requires a positive integer token', () => {
    expect(InstrumentToken.parse(408065)).toBe(408065);
    expect(InstrumentToken.safeParse(0).success).toBe(false);
    expect(InstrumentToken.safeParse(1.5).success).toBe(false);
  });

  it('allows url-safe ids only', () => {
    expect(Id.parse('wl_1-a')).toBe('wl_1-a');
    expect(Id.safeParse('').success).toBe(false);
    expect(Id.safeParse('a/b').success).toBe(false);
  });
});

describe('ApiError', () => {
  it('round-trips the envelope', () => {
    expect(ApiError.parse(apiErrorFixture)).toEqual(apiErrorFixture);
  });

  it('allows details to be omitted and rejects unknown codes', () => {
    expect(
      ApiError.safeParse({ error: { code: 'NOT_FOUND', message: 'No such stock' } }).success,
    ).toBe(true);
    expect(ApiError.safeParse({ error: { code: 'TEAPOT', message: 'x' } }).success).toBe(false);
  });
});

describe('cursor pagination', () => {
  const Page = cursorPage(z.number().int());

  it('parses a middle page and the last page', () => {
    expect(Page.parse({ items: [1, 2], nextCursor: 'abc' })).toEqual({
      items: [1, 2],
      nextCursor: 'abc',
    });
    expect(Page.parse({ items: [], nextCursor: null }).nextCursor).toBeNull();
  });

  it('requires nextCursor to be present', () => {
    expect(Page.safeParse({ items: [] }).success).toBe(false);
  });

  it('coerces the limit from the query string and bounds it', () => {
    expect(CursorQuery.parse({ limit: '20', cursor: 'abc' })).toEqual({ limit: 20, cursor: 'abc' });
    expect(CursorQuery.parse({})).toEqual({});
    expect(CursorQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(CursorQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('OkResponse', () => {
  it('only accepts ok: true', () => {
    expect(OkResponse.parse({ ok: true })).toEqual({ ok: true });
    expect(OkResponse.safeParse({ ok: false }).success).toBe(false);
  });
});
