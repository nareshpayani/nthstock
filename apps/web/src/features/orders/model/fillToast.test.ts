import { describe, expect, it } from 'vitest';
import { testOrder } from '@/test/orders';
import { fillToast } from './fillToast';

describe('fill toast (T-147)', () => {
  it('reads "Order executed: BUY 10 INFY @ ₹1,512.35"', () => {
    const toast = fillToast(
      testOrder({ status: 'EXECUTED', filledQty: 10, avgFillPrice: 151_235 }),
    );
    expect(toast && `${toast.title}: ${toast.description}`).toBe(
      'Order executed: BUY 10 INFY @ ₹1,512.35',
    );
  });

  it('reads "Order partly filled: BUY 3 / 10 INFY @ ₹1,512.35" for each partial fill (T11)', () => {
    const toast = fillToast(
      testOrder({ status: 'OPEN', qty: 10, filledQty: 3, avgFillPrice: 151_235 }),
    );
    expect(toast && `${toast.title}: ${toast.description}`).toBe(
      'Order partly filled: BUY 3 / 10 INFY @ ₹1,512.35',
    );
  });

  it('is only for executed and partly filled orders', () => {
    expect(fillToast(testOrder({ status: 'OPEN' }))).toBeNull();
    expect(fillToast(testOrder({ status: 'CANCELLED' }))).toBeNull();
  });
});
