import type { AccountDeltaEvent, Order } from '@nthstock/contracts';

/** A filled paper order for user-channel tests. */
export const testOrder = (id: string, overrides: Partial<Order> = {}): Order => ({
  id,
  clientOrderId: null,
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 10,
  price: 150_000,
  filledQty: 10,
  avgFillPrice: 150_000,
  status: 'EXECUTED',
  statusReason: null,
  validity: 'DAY',
  placedAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:31:00.000Z',
  ...overrides,
});

/** An account delta (NSTOCK-0368) carrying one order, for user-channel tests. */
export const testAccountDelta = (
  seq: number,
  overrides: Partial<AccountDeltaEvent['delta']> = {},
): AccountDeltaEvent['delta'] => ({
  seq,
  at: '2026-09-28T04:31:00.000Z',
  orders: [testOrder(`o_${String(seq)}`)],
  positions: [],
  trailingStops: [],
  ...overrides,
});
