import type { Order } from '@nthstock/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { OrderTable } from './OrderTable';

const AT = '2026-09-28T04:30:00.000Z';
const order: Order = {
  id: 'ord_1',
  clientOrderId: null,
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  validity: 'DAY',
  qty: 10,
  price: 150_000,
  filledQty: 0,
  avgFillPrice: null,
  status: 'OPEN',
  statusReason: null,
  seq: 1,
  placedAt: AT,
  updatedAt: AT,
};

describe('order book row while the order moves on the chart (T16, TFC-21)', () => {
  it('keeps the real price and shows the price it is moving to', async () => {
    const props = {
      orders: [order],
      label: 'Open orders',
      now: new Date(AT),
      onDetails: vi.fn(),
      onModify: vi.fn(),
      onCancel: vi.fn(),
    };
    renderWithProviders(
      <OrderTable
        {...props}
        pendingPrices={new Map([['ord_1', { price: 152_000, phase: 'dragging' }]])}
      />,
    );
    const table = await screen.findByRole('table', { name: 'Open orders' });
    const cell = within(table).getByText('Moving to ₹1,520.00');
    expect(cell.closest('td')).toHaveTextContent('₹1,500.00Moving to ₹1,520.00');
  });
});
