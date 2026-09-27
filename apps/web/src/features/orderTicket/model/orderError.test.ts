import { ApiError } from '@nthstock/apiClient';
import type { ApiErrorCode, Order } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { describeOrderError } from './orderError';

const rejected: Order = {
  id: 'pe_1',
  clientOrderId: 'tkt_1',
  token: 501,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'SELL',
  type: 'MARKET',
  product: 'DELIVERY',
  qty: 5,
  price: null,
  filledQty: 0,
  avgFillPrice: null,
  status: 'REJECTED',
  statusReason: 'You have no INFY shares to sell for delivery.',
  placedAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
};

const http = (status: number, code: ApiErrorCode, details?: Record<string, unknown>) =>
  new ApiError({ kind: 'http', status, code, message: 'Server says no.', details });

describe('describeOrderError (T-139)', () => {
  it('shows a 422 rejection with the stored order and its plain-language reason', () => {
    expect(
      describeOrderError(
        http(422, 'INSUFFICIENT_HOLDINGS', { reason: 'INSUFFICIENT_HOLDINGS', order: rejected }),
      ),
    ).toEqual({
      title: 'Not enough shares',
      message: 'You have no INFY shares to sell for delivery.',
      rejected,
    });
  });

  it.each([
    ['INSUFFICIENT_FUNDS', 'Not enough cash'],
    ['MARKET_CLOSED', 'Intraday is closed'],
    ['ORDER_REJECTED', 'Order rejected'],
  ] as const)('titles a 422 %s without an order from the message', (code, title) => {
    expect(describeOrderError(http(422, code))).toEqual({ title, message: 'Server says no.' });
  });

  it.each([
    [http(400, 'VALIDATION_ERROR'), 'Check the order', 'Server says no.'],
    [http(404, 'NOT_FOUND'), 'Order not placed', 'This stock is not available to trade.'],
    [http(401, 'UNAUTHORIZED'), 'Order not placed', /session has ended/],
    [http(429, 'RATE_LIMITED'), 'Order not placed', /Too many orders/],
    [http(500, 'INTERNAL_ERROR'), 'Order not placed', 'The order could not be placed. Try again.'],
    [
      new ApiError({ kind: 'network', status: 0, code: 'SERVICE_UNAVAILABLE', message: 'offline' }),
      'Order not placed',
      /Could not reach nthstock/,
    ],
    [new Error('boom'), 'Order not placed', 'The order could not be placed. Try again.'],
  ])('describes %s', (error, title, message) => {
    const described = describeOrderError(error);
    expect(described.title).toBe(title);
    expect(described.message).toMatch(message);
  });
});
