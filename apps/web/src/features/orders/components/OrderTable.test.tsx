import {
  TERMINAL_TRAILING_STOP_STATUSES,
  type Order,
  type TrailingStop,
  type TrailingStopStatus,
} from '@nthstock/contracts';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
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

describe('the order book on a phone (NSTOCK-0435)', () => {
  const screenIs = (phone: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: phone && query.includes('max-width: 767.98px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  const book = (count: number): Order[] =>
    Array.from({ length: count }, (_, n) => ({ ...order, id: `ord_${String(n + 1)}`, seq: n + 1 }));
  const renderBook = (orders: Order[], extra: Partial<Parameters<typeof OrderTable>[0]> = {}) => {
    const handlers = { onDetails: vi.fn(), onModify: vi.fn(), onCancel: vi.fn() };
    renderWithProviders(
      <OrderTable
        orders={orders}
        label="Open orders"
        now={new Date(AT)}
        {...handlers}
        {...extra}
      />,
    );
    return handlers;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    usePositionEditorStore.setState(initialPositionEditorState);
  });

  it('lists each order as a row with every field and action, not a wide table', async () => {
    screenIs(true);
    const { onDetails, onModify, onCancel } = renderBook([order]);
    const list = await screen.findByRole('list', { name: 'Open orders' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const row = within(list).getByRole('listitem');
    for (const text of ['INFY', 'NSE', '₹1,500.00', 'Buy', 'Limit', 'Delivery', '0 / 10']) {
      expect(row).toHaveTextContent(text);
    }
    expect(within(row).getByRole('time')).toHaveAttribute('dateTime', AT);
    expect(within(row).getByText('Open')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Details of BUY 10 INFY order' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Modify BUY 10 INFY order' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel BUY 10 INFY order' }));
    expect(onDetails).toHaveBeenCalledWith(order, expect.any(HTMLElement));
    expect(onModify).toHaveBeenCalledWith(order);
    expect(onCancel).toHaveBeenCalledWith(order, expect.any(HTMLElement));
  });

  it('shows the price an order is moving to, its trailing stop and Edit stop', async () => {
    screenIs(true);
    const executed: Order = {
      ...order,
      type: 'MARKET',
      price: null,
      status: 'EXECUTED',
      filledQty: 10,
    };
    const stop: TrailingStop = {
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
    renderBook([order, { ...executed, id: 'ord_2' }, { ...order, id: 'ord_3' }], {
      pendingPrices: new Map([['ord_1', { price: 152_000, phase: 'dragging' as const }]]),
      stops: new Map([
        ['ord_2', stop],
        ['ord_3', stop],
      ]),
    });
    const list = await screen.findByRole('list', { name: 'Open orders' });
    const [open, done, openWithStop] = within(list).getAllByRole('listitem');
    if (!open || !done || !openWithStop) throw new Error('missing rows');
    expect(open).toHaveTextContent('Moving to ₹1,520.00');
    // An open order with a live stop has four actions: they wrap rather than widen the row.
    expect(within(openWithStop).getAllByRole('button')).toHaveLength(4);
    expect(within(openWithStop).getByTestId('order-actions')).toHaveClass('flex-wrap');
    expect(list).toHaveClass('grid-cols-[minmax(0,1fr)]');
    fireEvent.click(
      within(done).getByRole('button', { name: 'Edit the trailing stop of BUY 10 INFY order' }),
    );
    expect(usePositionEditorStore.getState().target).toMatchObject({ symbol: 'INFY', tab: 'stop' });
  });

  it('keeps the table on a wider screen', async () => {
    screenIs(false);
    renderBook([order]);
    expect(await screen.findByRole('table', { name: 'Open orders' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Open orders' })).not.toBeInTheDocument();
  });

  it('lists up to 50 orders and scrolls a longer book sideways inside its card', async () => {
    screenIs(true);
    renderBook(book(50));
    expect(await screen.findByRole('list', { name: 'Open orders' })).toBeInTheDocument();
    cleanup();
    renderBook(book(51));
    const grid = await screen.findByRole('grid', { name: 'Open orders' });
    expect(grid.parentElement).toHaveAttribute('data-testid', 'order-grid-scroller');
    expect(grid.parentElement).toHaveClass('overflow-x-auto', 'relative');
  });
});
