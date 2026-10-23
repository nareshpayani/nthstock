import type { Depth, Order } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  ackFor,
  closeAck,
  parseQty,
  reverseAck,
  scalpRequest,
  sendingAck,
  touchPrices,
} from './scalpOrder';

const level = (price: number) => ({ price, qty: 100, orders: 2 });
const depth = (bid: number, ask: number) =>
  ({
    bids: [level(bid), level(bid - 5), level(bid - 10), level(bid - 15), level(bid - 20)],
    asks: [level(ask), level(ask + 5), level(ask + 10), level(ask + 15), level(ask + 20)],
  }) as unknown as Depth;

const ORDER: Order = {
  id: 'ord_1',
  clientOrderId: 'scp_1',
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'LIMIT',
  product: 'INTRADAY',
  qty: 10,
  price: 123_455,
  filledQty: 10,
  avgFillPrice: 123_455,
  status: 'EXECUTED',
  statusReason: null,
  validity: 'IOC',
  placedAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
};

describe('scalp orders (T21, SPEC-TFC-1 §11.2)', () => {
  it('takes the best bid and ask from the depth', () => {
    expect(touchPrices(depth(123_445, 123_455))).toEqual({ bid: 123_445, ask: 123_455 });
    expect(touchPrices(null)).toEqual({ bid: null, ask: null });
    expect(touchPrices(depth(0, 0))).toEqual({ bid: null, ask: null });
  });

  it('sends an intraday IOC limit at the price on the button', () => {
    expect(scalpRequest('BUY', 10, 123_455, 2885, 'scp_1')).toEqual({
      token: 2885,
      side: 'BUY',
      type: 'LIMIT',
      product: 'INTRADAY',
      qty: 10,
      price: 123_455,
      validity: 'IOC',
      clientOrderId: 'scp_1',
    });
  });

  it('acknowledges a fill, a part fill, no fill and a rejection in words', () => {
    const base = ORDER;
    expect(sendingAck('SELL', 5)).toEqual({ tone: 'sending', text: 'Selling 5…' });
    expect(ackFor({ ...base, status: 'EXECUTED', filledQty: 10, avgFillPrice: 123_455 })).toEqual({
      tone: 'filled',
      text: 'Bought 10 @ ₹1,234.55',
    });
    expect(
      ackFor({ ...base, side: 'SELL', status: 'CANCELLED', filledQty: 4, avgFillPrice: 123_445 }),
    ).toEqual({ tone: 'partial', text: 'Sold 4 of 10 @ ₹1,234.45 · rest cancelled' });
    expect(ackFor({ ...base, status: 'CANCELLED', filledQty: 0, avgFillPrice: null }).tone).toBe(
      'unfilled',
    );
    expect(
      ackFor({ ...base, status: 'REJECTED', filledQty: 0, avgFillPrice: null, statusReason: 'No' }),
    ).toEqual({ tone: 'rejected', text: 'Rejected: No' });
  });

  it('reads a custom size: whole shares, 1 or more', () => {
    expect(parseQty('40')).toBe(40);
    expect(parseQty(' 7 ')).toBe(7);
    expect(parseQty('0')).toBeNull();
    expect(parseQty('2.5')).toBeNull();
    expect(parseQty('')).toBeNull();
  });
});

describe('close and reverse acknowledgements (T22, SPEC-TFC-1 §11.2)', () => {
  const EXIT: Order = {
    ...ORDER,
    id: 'ord_2',
    clientOrderId: null,
    side: 'SELL',
    type: 'MARKET',
    price: null,
    validity: 'DAY',
  };

  it('a full close says what was closed', () => {
    expect(closeAck(EXIT)).toEqual({ tone: 'filled', text: 'Closed: sold 10 @ ₹1,234.55' });
  });

  it('a part close says how much is left', () => {
    expect(closeAck({ ...EXIT, filledQty: 6, status: 'CANCELLED' })).toEqual({
      tone: 'partial',
      text: 'Partly closed: 4 left',
    });
  });

  it('a close with no fill, or a rejected one, says so', () => {
    expect(closeAck({ ...EXIT, filledQty: 0, avgFillPrice: null, status: 'CANCELLED' }).tone).toBe(
      'unfilled',
    );
    expect(
      closeAck({
        ...EXIT,
        filledQty: 0,
        avgFillPrice: null,
        status: 'REJECTED',
        statusReason: 'Market closed',
      }),
    ).toEqual({ tone: 'rejected', text: 'Rejected: Market closed' });
  });

  it('a reverse names its entry, or says the entry did not fill', () => {
    const entry: Order = { ...ORDER, side: 'SELL' };
    expect(reverseAck(entry)).toEqual({ tone: 'filled', text: 'Reversed: Sold 10 @ ₹1,234.55' });
    expect(reverseAck({ ...entry, filledQty: 0, avgFillPrice: null, status: 'CANCELLED' })).toEqual(
      {
        tone: 'unfilled',
        text: 'Closed, but the reverse entry did not fill: the price moved.',
      },
    );
    expect(
      reverseAck({
        ...entry,
        filledQty: 0,
        avgFillPrice: null,
        status: 'REJECTED',
        statusReason: 'Insufficient funds',
      }).text,
    ).toBe('Closed, but the reverse entry was rejected: Insufficient funds');
  });
});
