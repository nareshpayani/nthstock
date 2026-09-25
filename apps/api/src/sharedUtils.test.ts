import { formatInr, getMarketStatus, fixedClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';

// Proves the API workspace resolves the shared utils package (T-002).
describe('@nthstock/utils in apps/api', () => {
  it('formats paise and reads market hours', () => {
    expect(formatInr(10000050)).toBe('₹1,00,000.50');
    expect(getMarketStatus(fixedClock('2026-09-25T04:00:00Z'))).toEqual({ state: 'open' });
  });
});
