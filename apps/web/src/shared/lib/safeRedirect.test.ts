import { describe, expect, it } from 'vitest';
import { DEFAULT_AFTER_LOGIN, safeRedirect } from './safeRedirect';

describe('safeRedirect', () => {
  it.each(['/orders', '/stocks/INFY?range=1Y', '/funds#ledger'])('keeps %s', (target) => {
    expect(safeRedirect(target)).toBe(target);
  });

  it.each([
    undefined,
    '',
    'orders',
    'https://evil.example',
    '//evil.example/x',
    '/\\evil.example',
    '/login',
    '/login?redirect=%2Forders',
    42,
  ])('falls back to the dashboard for %s', (target) => {
    expect(safeRedirect(target)).toBe(DEFAULT_AFTER_LOGIN);
  });
});
