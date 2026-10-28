import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberChartType, rememberedChartType } from './chartTypePreference';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('remembered chart type (NSTOCK-0430)', () => {
  it('falls back to area when nothing is stored', () => {
    expect(rememberedChartType()).toBe('area');
  });

  it('returns what was last remembered', () => {
    rememberChartType('heikin');
    expect(rememberedChartType()).toBe('heikin');
  });

  it('falls back to area for a stored value that is not a chart type', () => {
    window.localStorage.setItem('nthstock.chartType', 'renko');
    expect(rememberedChartType()).toBe('area');
  });

  it('falls back to area when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(rememberedChartType()).toBe('area');
  });
});
