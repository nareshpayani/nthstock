import { afterEach, describe, expect, it } from 'vitest';
import { claimFillToast, resetFillToasts } from './fillToasts';

afterEach(() => {
  resetFillToasts();
});

describe('claimFillToast (T-147)', () => {
  it('lets only the first claim of an order through', () => {
    expect(claimFillToast('pe_1')).toBe(true);
    expect(claimFillToast('pe_1')).toBe(false);
    expect(claimFillToast('pe_2')).toBe(true);
  });

  it('remembers a bounded number of orders, forgetting the oldest first', () => {
    for (let i = 0; i < 501; i += 1) claimFillToast(`pe_${String(i)}`);
    expect(claimFillToast('pe_0')).toBe(true);
    expect(claimFillToast('pe_500')).toBe(false);
  });
});
