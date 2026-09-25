import { formatChange, formatInr } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';

// Proves the web workspace resolves the shared utils package (T-002).
describe('@nthstock/utils in apps/web', () => {
  it('formats money and change for the UI', () => {
    expect(formatInr(10000050)).toBe('₹1,00,000.50');
    expect(formatChange(125).text).toBe('▲ 1.25%');
  });
});
