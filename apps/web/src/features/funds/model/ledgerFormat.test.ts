import { describe, expect, it } from 'vitest';
import { ledgerTimeLabel, signedAmount } from './ledgerFormat';

describe('ledger formatting (T-159)', () => {
  it('shows UTC times in IST with the date', () => {
    // 04:30 UTC is 10:00 IST.
    expect(ledgerTimeLabel('2026-09-28T04:30:04.000Z')).toMatch(/^28 Sept? 2026, 10:00:04 am$/i);
  });

  it('signs amounts in the text and says credit or debit', () => {
    expect(signedAmount(1_50_000_00)).toEqual({
      text: '+₹1,50,000.00',
      spoken: 'credit ₹1,50,000.00',
    });
    expect(signedAmount(-15_000_00)).toEqual({ text: '-₹15,000.00', spoken: 'debit ₹15,000.00' });
    expect(signedAmount(0)).toEqual({ text: '₹0.00', spoken: '₹0.00' });
  });
});
