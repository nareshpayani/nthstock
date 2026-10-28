import {
  TERMINAL_TRAILING_STOP_STATUSES,
  type Order,
  type TrailingStop,
  type TrailingStopStatus,
} from '@nthstock/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initialPositionEditorState,
  usePositionEditorStore,
} from '@/shared/lib/positionEditorStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { orderTimeLabel } from '../model/orderBook';
import { strings } from '../strings';
import { OrderTable, VIRTUAL_ORDER_ROWS } from './OrderTable';

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

const stubMedia = (phone: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query.includes('max-width: 767.98px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

const trailingStop: TrailingStop = {
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
  status: 'TRAILING',
  statusReason: null,
  watermarkPrice: 150_000,
  stopPrice: 148_500,
  protectedQty: 10,
  entryOrderId: 'ord_1',
  exitOrderId: null,
  seq: 1,
  createdAt: AT,
  updatedAt: AT,
};

const manyOrders = (count: number): Order[] =>
  Array.from({ length: count }, (_, i) => ({ ...order, id: `ord_${i + 1}`, seq: i + 1 }));

const renderBook = (orders: Order[], extra: Partial<ComponentProps<typeof OrderTable>> = {}) => {
  const handlers = { onDetails: vi.fn(), onModify: vi.fn(), onCancel: vi.fn() };
  const view = renderWithProviders(
    <OrderTable orders={orders} label="Open orders" now={new Date(AT)} {...handlers} {...extra} />,
  );
  return { ...handlers, view };
};

describe('the order book on a phone (NSTOCK-0435)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    usePositionEditorStore.setState(initialPositionEditorState);
  });

  it('lists each order as a row with every field and its actions', async () => {
    stubMedia(true);
    const { onCancel, onDetails, onModify } = renderBook([order]);
    const list = await screen.findByRole('list', { name: 'Open orders' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const row = within(list).getByRole('listitem');
    expect(row).toHaveTextContent('INFY');
    expect(row).toHaveTextContent('NSE');
    expect(row).toHaveTextContent('₹1,500.00');
    expect(row).toHaveTextContent('Buy');
    expect(row).toHaveTextContent(strings.types.LIMIT);
    expect(row).toHaveTextContent(strings.products.DELIVERY);
    expect(row).toHaveTextContent(strings.qty(0, 10));
    expect(row.querySelector('time')).toHaveAttribute('dateTime', AT);
    expect(row).toHaveTextContent(orderTimeLabel(AT, new Date(AT)));
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel BUY 10 INFY order' }));
    expect(onCancel).toHaveBeenCalledWith(order, expect.any(HTMLElement));
    fireEvent.click(
      within(row).getByRole('button', { name: strings.actions.detailsLabel('BUY 10 INFY order') }),
    );
    expect(onDetails).toHaveBeenCalledWith(order, expect.any(HTMLElement));
    fireEvent.click(
      within(row).getByRole('button', { name: strings.actions.modifyLabel('BUY 10 INFY order') }),
    );
    expect(onModify).toHaveBeenCalledWith(order);
  });

  it('shows the pending price, the trailing-stop badge and Edit stop', async () => {
    stubMedia(true);
    renderBook([{ ...order, type: 'MARKET', price: null, status: 'EXECUTED', filledQty: 10 }], {
      pendingPrices: new Map([['ord_1', { price: 152_000, phase: 'dragging' }]]),
      stops: new Map([['ord_1', trailingStop]]),
    });
    const list = await screen.findByRole('list', { name: 'Open orders' });
    const row = within(list).getByRole('listitem');
    expect(row).toHaveTextContent('Moving to ₹1,520.00');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Edit the trailing stop of BUY 10 INFY order' }),
    );
    expect(usePositionEditorStore.getState().target).toMatchObject({ symbol: 'INFY', tab: 'stop' });
  });

  it('keeps the table on a desktop screen', async () => {
    stubMedia(false);
    renderBook([order]);
    await screen.findByRole('table', { name: 'Open orders' });
    expect(screen.queryByRole('list', { name: 'Open orders' })).not.toBeInTheDocument();
  });

  it('lists 50 orders, and scrolls 51 inside a wrapper instead of the page', async () => {
    stubMedia(true);
    const first = renderBook(manyOrders(VIRTUAL_ORDER_ROWS));
    const list = await screen.findByRole('list', { name: 'Open orders' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(VIRTUAL_ORDER_ROWS);
    expect(screen.queryByTestId('order-virtual-scroller')).not.toBeInTheDocument();
    first.view.unmount();

    renderBook(manyOrders(VIRTUAL_ORDER_ROWS + 1));
    expect(screen.queryByRole('list', { name: 'Open orders' })).not.toBeInTheDocument();
    const scroller = await screen.findByTestId('order-virtual-scroller');
    expect(scroller).toHaveClass('overflow-x-auto');
    const grid = scroller.firstElementChild;
    expect(grid).toHaveClass('min-w-[960px]');
  });
});
