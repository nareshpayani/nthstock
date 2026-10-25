import {
  TERMINAL_TRAILING_STOP_STATUSES,
  type Order,
  type TrailingStop,
  type TrailingStopStatus,
} from '@nthstock/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initialPositionEditorState,
  usePositionEditorStore,
} from '@/shared/lib/positionEditorStore';
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

describe('Edit stop on an order with a trailing stop (NSTOCK-0395)', () => {
  const executed: Order = {
    ...order,
    type: 'MARKET',
    price: null,
    status: 'EXECUTED',
    filledQty: 10,
  };
  const stopWith = (status: TrailingStopStatus): TrailingStop => ({
    id: 'ts_1',
    token: 408065,
    symbol: 'INFY',
    exchange: 'NSE',
    product: 'DELIVERY',
    direction: 'LONG',
    trail: { unit: 'PERCENT', basisPoints: 100 },
    activationPrice: null,
    exitOrderType: 'MARKET',
    exitLimitOffset: null,
    status,
    statusReason: null,
    watermarkPrice: 150_000,
    stopPrice: 148_500,
    protectedQty: 10,
    entryOrderId: 'ord_1',
    exitOrderId: null,
    seq: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  const renderRow = (stop?: TrailingStop) =>
    renderWithProviders(
      <OrderTable
        orders={[executed]}
        label="Executed orders"
        now={new Date(AT)}
        onDetails={vi.fn()}
        onModify={vi.fn()}
        onCancel={vi.fn()}
        {...(stop ? { stops: new Map([['ord_1', stop]]) } : {})}
      />,
    );
  const editStop = () =>
    screen.queryByRole('button', { name: 'Edit the trailing stop of BUY 10 INFY order' });

  afterEach(() => usePositionEditorStore.setState(initialPositionEditorState));

  it('opens the position editor on its stop tab for an active stop', async () => {
    renderRow(stopWith('TRAILING'));
    await screen.findByRole('table', { name: 'Executed orders' });
    const button = editStop();
    if (!button) throw new Error('no Edit stop');
    fireEvent.click(button);
    expect(usePositionEditorStore.getState().target).toEqual({
      symbol: 'INFY',
      exchange: 'NSE',
      token: 408065,
      product: 'DELIVERY',
      tab: 'stop',
    });
  });

  it('is absent with no stop and once the stop has ended', async () => {
    const { unmount } = renderRow();
    await screen.findByRole('table', { name: 'Executed orders' });
    expect(editStop()).toBeNull();
    unmount();
    for (const status of TERMINAL_TRAILING_STOP_STATUSES) {
      const view = renderRow(stopWith(status));
      await screen.findByRole('table', { name: 'Executed orders' });
      expect(editStop()).toBeNull();
      view.unmount();
    }
  });
});
