import { describe, expect, it } from 'vitest';
import { testOrder } from '@/test/orders';
import { isWorkingLimit, orderLine } from './orderLines';

describe('orderLine loupe (CR-T07)', () => {
  it("prices the order's open quantity, not the whole order, once it has part filled", () => {
    const order = testOrder({
      type: 'LIMIT',
      status: 'OPEN',
      price: 150_000,
      qty: 10,
      filledQty: 4,
    });
    expect(isWorkingLimit(order)).toBe(true);
    if (!isWorkingLimit(order)) return;
    expect(orderLine(order, undefined, false).loupe).toEqual({ kind: 'value', qty: 6 });
  });
});
