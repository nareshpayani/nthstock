import { describe, expect, it } from 'vitest';
import { keepInterval, resolveInterval } from './ranges';

describe('resolveInterval (NSTOCK-0343)', () => {
  it('uses the range’s own bar size when none is asked for', () => {
    expect(resolveInterval('1D')).toBe('1m');
    expect(resolveInterval('1W')).toBe('5m');
    expect(resolveInterval('5Y')).toBe('1w');
  });

  it('keeps a bar size the range offers and replaces one it does not', () => {
    expect(resolveInterval('1D', '15m')).toBe('15m');
    expect(resolveInterval('1Y', '1w')).toBe('1w');
    expect(resolveInterval('1W', '1m')).toBe('5m');
    expect(resolveInterval('5Y', '1d')).toBe('1w');
  });
});

describe('keepInterval (NSTOCK-0443)', () => {
  it('keeps the chosen bar size across a range change when the new range offers it', () => {
    expect(keepInterval('1W', '5m')).toBe('5m');
    expect(keepInterval('1M', '1h')).toBe('1h');
  });

  it('drops it when the new range does not offer it, or none was chosen', () => {
    expect(keepInterval('1W', '1m')).toBeUndefined();
    expect(keepInterval('5Y', '1d')).toBeUndefined();
    expect(keepInterval('1D', undefined)).toBeUndefined();
  });
});
