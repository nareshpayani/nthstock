import { describe, expect, it } from 'vitest';
import { formatInr, formatInrCompact, parseRupeesToPaise } from './money.js';

describe('formatInr', () => {
  it('formats zero', () => {
    expect(formatInr(0)).toBe('₹0.00');
  });

  it('uses Indian lakh grouping', () => {
    expect(formatInr(10000050)).toBe('₹1,00,000.50');
    expect(formatInr(123456789)).toBe('₹12,34,567.89');
  });

  it('formats negatives with a leading minus', () => {
    expect(formatInr(-5)).toBe('-₹0.05');
    expect(formatInr(-150000)).toBe('-₹1,500.00');
  });

  it('rejects non-integer paise', () => {
    expect(() => formatInr(10.5)).toThrow(RangeError);
    expect(() => formatInr(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatInrCompact', () => {
  it('shows crores', () => {
    expect(formatInrCompact(1_200_000_000)).toBe('₹1.2 Cr');
    expect(formatInrCompact(1_000_000_000)).toBe('₹1 Cr');
    expect(formatInrCompact(123_456_789_000)).toBe('₹123.46 Cr');
  });

  it('shows lakhs', () => {
    expect(formatInrCompact(125_000_000)).toBe('₹12.5 L');
    expect(formatInrCompact(12_500_000)).toBe('₹1.25 L');
    expect(formatInrCompact(10_000_000)).toBe('₹1 L');
  });

  it('falls back to full format under a lakh', () => {
    expect(formatInrCompact(9_999_999)).toBe('₹99,999.99');
  });

  it('keeps the sign', () => {
    expect(formatInrCompact(-1_200_000_000)).toBe('-₹1.2 Cr');
  });
});

describe('parseRupeesToPaise', () => {
  it.each([
    ['0', 0],
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['1,00,000.50', 10000050],
    ['1,234.5', 123450],
    ['₹ 99', 9900],
    ['-12.05', -1205],
    ['-₹5', -500],
    ['  7.10 ', 710],
  ])('parses %s', (input, expected) => {
    expect(parseRupeesToPaise(input)).toBe(expected);
  });

  it.each(['12.345', '', 'abc', '1.2.3', '12.', '.5', '1e3', '99999999999999999'])(
    'rejects %s',
    (input) => {
      expect(parseRupeesToPaise(input)).toBeNull();
    },
  );

  it('never returns negative zero', () => {
    expect(Object.is(parseRupeesToPaise('-0'), 0)).toBe(true);
  });
});
