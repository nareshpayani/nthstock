import type { Order } from '@nthstock/contracts';

/** A schema-valid paper order for tests and stories (made-up ids, no real data). */
export function testOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'pe_test1',
    clientOrderId: null,
    token: 408065,
    symbol: 'INFY',
    exchange: 'NSE',
    side: 'BUY',
    type: 'LIMIT',
    product: 'DELIVERY',
    qty: 10,
    price: 151_000,
    filledQty: 0,
    avgFillPrice: null,
    status: 'OPEN',
    statusReason: null,
    placedAt: '2026-09-28T04:30:00.000Z',
    updatedAt: '2026-09-28T04:30:00.000Z',
    ...overrides,
  };
}
