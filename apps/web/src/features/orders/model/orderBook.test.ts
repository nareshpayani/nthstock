import type { OrderStatus } from '@nthstock/contracts';
import { fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { testOrder } from '@/test/orders';
import {
  ORDER_TABS,
  TAB_STATUSES,
  groupOrders,
  isLive,
  orderName,
  orderTimeLabel,
  priceLabel,
  tabOf,
} from './orderBook';

const statuses: OrderStatus[] = ['AMO', 'OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED'];

describe('order book model (T-144)', () => {
  it('puts every status in exactly one tab: Cancelled includes Rejected', () => {
    for (const status of statuses) {
      const tabs = ORDER_TABS.filter((tab) => TAB_STATUSES[tab].includes(status));
      expect(tabs).toEqual([tabOf(status)]);
    }
    expect(TAB_STATUSES.cancelled).toEqual(['CANCELLED', 'REJECTED']);
    expect(TAB_STATUSES.open).toEqual(['AMO', 'OPEN']);
  });

  it('groups orders by tab, keeping their order, so counts are the rows', () => {
    const orders = statuses.map((status, index) =>
      testOrder({ id: `pe_${String(index)}`, status }),
    );
    const book = groupOrders(orders);
    expect(book.open.map((o) => o.status)).toEqual(['AMO', 'OPEN']);
    expect(book.executed.map((o) => o.status)).toEqual(['EXECUTED']);
    expect(book.cancelled.map((o) => o.status)).toEqual(['CANCELLED', 'REJECTED']);
    expect(book.open.length + book.executed.length + book.cancelled.length).toBe(orders.length);
  });

  it('shows the IST time today, and the date too for an earlier day', () => {
    const now = fromIst(2026, 9, 28, 11 * 60);
    expect(orderTimeLabel(fromIst(2026, 9, 28, 10 * 60).toISOString(), now).toLowerCase()).toBe(
      '10:00:00 am',
    );
    expect(orderTimeLabel(fromIst(2026, 9, 25, 20 * 60).toISOString(), now)).toMatch(
      /^25 Sept? 2026, 08:00:00 (pm|PM)$/,
    );
  });

  it('prices a row by its fill, its limit or "Market"', () => {
    expect(priceLabel(testOrder({ price: 151_000 }))).toBe('₹1,510.00');
    expect(priceLabel(testOrder({ type: 'MARKET', price: null }))).toBe('Market');
    expect(
      priceLabel(testOrder({ status: 'EXECUTED', filledQty: 10, avgFillPrice: 151_235 })),
    ).toBe('₹1,512.35');
  });

  it('only AMO and OPEN orders are live, and names read as the order', () => {
    expect(statuses.filter((status) => isLive({ status }))).toEqual(['AMO', 'OPEN']);
    expect(orderName(testOrder({ side: 'SELL', qty: 3, symbol: 'TCS' }))).toBe('SELL 3 TCS order');
  });
});
