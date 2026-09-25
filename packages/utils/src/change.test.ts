import { describe, expect, it } from 'vitest';
import { formatChange, formatPct } from './change.js';

describe('formatPct', () => {
  it('formats basis points', () => {
    expect(formatPct(125)).toBe('1.25%');
    expect(formatPct(5)).toBe('0.05%');
    expect(formatPct(-50)).toBe('-0.50%');
    expect(formatPct(0)).toBe('0.00%');
  });

  it('rejects non-integers', () => {
    expect(() => formatPct(1.5)).toThrow(RangeError);
  });
});

describe('formatChange', () => {
  it('marks a rise with ▲ and text', () => {
    expect(formatChange(125)).toEqual({
      text: '▲ 1.25%',
      direction: 'up',
      srLabel: 'up 1.25 percent',
    });
  });

  it('marks a fall with ▼ and text', () => {
    expect(formatChange(-340)).toEqual({
      text: '▼ 3.40%',
      direction: 'down',
      srLabel: 'down 3.40 percent',
    });
  });

  it('returns a flat marker for zero', () => {
    expect(formatChange(0)).toEqual({ text: '● 0.00%', direction: 'flat', srLabel: 'unchanged' });
  });
});
