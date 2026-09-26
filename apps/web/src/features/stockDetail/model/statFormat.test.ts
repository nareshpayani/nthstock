import { describe, expect, it } from 'vitest';
import { formatCount, formatX100, formatYield, rangePercent } from './statFormat';

describe('key stat formatting (T-109)', () => {
  it('groups counts the Indian way', () => {
    expect(formatCount(12345678)).toBe('1,23,45,678');
    expect(formatCount(0)).toBe('0');
  });

  it('turns ×100 integers into two-decimal text', () => {
    expect(formatX100(2453)).toBe('24.53');
    expect(formatX100(105)).toBe('1.05');
    expect(formatX100(123456)).toBe('1,234.56');
    expect(formatX100(-250)).toBe('-2.50');
    expect(() => formatX100(24.5)).toThrow(RangeError);
  });

  it('formats a dividend yield from basis points', () => {
    expect(formatYield(135)).toBe('1.35%');
  });

  it('places a value on a range bar, clamped, with a flat range in the middle', () => {
    expect(rangePercent(100, 200, 150)).toBe(50);
    expect(rangePercent(100, 200, 100)).toBe(0);
    expect(rangePercent(100, 200, 250)).toBe(100);
    expect(rangePercent(100, 200, 50)).toBe(0);
    expect(rangePercent(100, 100, 100)).toBe(50);
  });
});
