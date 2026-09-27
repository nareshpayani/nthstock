import type { Order } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { modifiedToast, successToast } from './orderToast';

const order = (overrides: Partial<Order>): Order => ({
  id: 'pe_1',
  clientOrderId: null,
  token: 501,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'MARKET',
  product: 'DELIVERY',
  qty: 10,
  price: null,
  filledQty: 0,
  avgFillPrice: null,
  status: 'OPEN',
  statusReason: null,
  placedAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
  ...overrides,
});

describe('successToast (T-139)', () => {
  it('names an executed order with its fill price', () => {
    expect(
      successToast(order({ status: 'EXECUTED', filledQty: 10, avgFillPrice: 151235 })),
    ).toEqual({ title: 'Order executed', description: 'BUY 10 INFY @ ₹1,512.35' });
  });

  it('names an open limit order with its limit price', () => {
    expect(successToast(order({ type: 'LIMIT', price: 150000, side: 'SELL' }))).toEqual({
      title: 'Order placed',
      description: 'SELL 10 INFY @ ₹1,500.00',
    });
  });

  it('says when an AMO goes to the exchange', () => {
    expect(successToast(order({ status: 'AMO' }))).toEqual({
      title: 'AMO placed',
      description: 'BUY 10 INFY at market price. Goes to the exchange at 9:15 AM.',
    });
  });

  it('says "Order modified" with the new terms (T-145)', () => {
    expect(modifiedToast(order({ type: 'LIMIT', qty: 6, price: 149_500 }))).toEqual({
      title: 'Order modified',
      description: 'BUY 6 INFY @ ₹1,495.00',
    });
    expect(modifiedToast(order({ qty: 2 })).description).toBe('BUY 2 INFY at market price');
  });
});
