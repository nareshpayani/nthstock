import { createTradingStore, type ApiClient, type TradingStore } from '@nthstock/apiClient';
import type { AccountState, Order } from '@nthstock/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartHandle } from '@/features/charts';
import { initialOrderDraftState, useOrderDraftStore } from '@/shared/lib/orderDraftStore';
import { AreaSeries, chartsMock, createChart } from '@/test/chartsMock';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CANCEL_ARM_MS, ChartTrading } from './ChartTrading';

// The fake scale: ₹1,600.00 at y = 0, 50 paise per px, a 300 px pane.
const AT = '2026-09-28T04:30:00.000Z';
const INFY = { symbol: 'INFY', tickSize: 5, token: 408065 };

function makeHandle(): ChartHandle {
  const host = document.createElement('div');
  document.body.append(host);
  const chart = createChart(host, {});
  const series = chart.addSeries(AreaSeries);
  return { chart, series, host } as unknown as ChartHandle;
}
const series = () => chartsMock.active().at(-1)?.series[0];

function pointer(target: Element, type: string, clientY: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

const limit = (extra: Partial<Order> = {}): Order => ({
  id: 'ord_1',
  clientOrderId: null,
  token: INFY.token,
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
  ...extra,
});

const account = (orders: Order[]): AccountState => ({
  seq: 1,
  orders,
  positions: [],
  trailingStops: [],
  funds: {
    openingBalance: 100_000_000,
    balance: 100_000_000,
    blocked: 0,
    available: 100_000_000,
    realisedPnlToday: 0,
    asOf: AT,
  },
});

type Answer = { resolve: (order: Order) => void; reject: (error: unknown) => void };

/** A fake API whose modify and cancel calls wait until the test answers them. */
function fakeApi() {
  const calls: { route: string; args: unknown; answer: Answer }[] = [];
  const api = {
    request: vi.fn(
      (route: string, args: unknown) =>
        new Promise<Order>((resolve, reject) => {
          calls.push({ route, args, answer: { resolve, reject } });
        }),
    ),
  } as unknown as ApiClient;
  return { api, calls };
}

async function setup(orders: Order[]) {
  const { api, calls } = fakeApi();
  const store: TradingStore = createTradingStore({
    loadState: () => Promise.resolve(account(orders)),
    schedule: (flush) => queueMicrotask(flush),
  });
  await store.start();
  renderWithProviders(<ChartTrading handle={makeHandle()} instrument={INFY} />, {
    apiClient: api,
    tradingStore: store,
  });
  await screen.findByRole('group', { name: 'Chart orders for INFY' });
  return { store, calls };
}

const handleFor = (id: string) =>
  screen.getAllByTestId('chart-handle').find((el) => el.dataset.line === id) as HTMLElement;

afterEach(() => {
  chartsMock.reset();
  useOrderDraftStore.setState(initialOrderDraftState);
  vi.useRealTimers();
});

describe('order lines (T16, SPEC-TFC-1 §8.1, §8.3)', () => {
  it('draws working limit orders as labelled buy and sell lines; filled and market orders are not lines', async () => {
    await setup([
      limit(),
      limit({ id: 'ord_2', side: 'SELL', price: 155_000, qty: 4 }),
      limit({ id: 'ord_3', status: 'EXECUTED', filledQty: 10, avgFillPrice: 150_000 }),
      limit({ id: 'ord_4', type: 'MARKET', price: null }),
      limit({ id: 'ord_5', token: 1 }),
    ]);
    // The edge arrows are in the markup but hidden unless pinned.
    const labels = screen
      .getAllByTestId('chart-handle')
      .map((el) => el.textContent.replace(/[↑↓]/g, ''))
      .sort();
    expect(labels).toEqual(['Buy 10 @ ₹1,500.00', 'Sell 4 @ ₹1,550.00']);
    expect(handleFor('ord_1')).toHaveAttribute('data-tone', 'buy');
    expect(handleFor('ord_2')).toHaveAttribute('data-tone', 'sell');
    expect(
      series()
        ?.priceLines.map((line) => line.options.price)
        .sort(),
    ).toEqual([150_000, 155_000]);
    expect(
      screen.getByRole('button', { name: /^Buy limit, 10 shares at ₹1,500\.00\. Drag/ }),
    ).toBeInTheDocument();
  });

  it('a drag shows the price under the finger to every surface and sends one modify on release', async () => {
    const { store, calls } = await setup([limit()]);
    const handle = handleFor('ord_1');
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 180);
    pointer(handle, 'pointermove', 160);
    expect(useOrderDraftStore.getState().draft).toEqual({ orderId: 'ord_1', price: 152_000 });
    expect(handle).toHaveTextContent('Buy 10 @ ₹1,520.00');
    expect(calls).toEqual([]);

    pointer(handle, 'pointerup', 160);
    expect(useOrderDraftStore.getState().draft).toBeNull();
    expect(calls.map((call) => [call.route, call.args])).toEqual([
      ['orderModify', { params: { id: 'ord_1' }, body: { price: 152_000 } }],
    ]);
    // Sent: dotted at the new price, "Updating…", until the engine answers.
    await waitFor(() => expect(handleFor('ord_1')).toHaveAttribute('data-tone', 'pending'));
    expect(handleFor('ord_1')).toHaveTextContent('Updating… ₹1,520.00');
    expect(store.getState().pending).toMatchObject([{ kind: 'modify', price: 152_000 }]);

    await act(async () => calls[0]?.answer.resolve(limit({ price: 152_000, seq: 2 })));
    await waitFor(() => expect(handleFor('ord_1')).toHaveAttribute('data-tone', 'buy'));
    expect(handleFor('ord_1')).toHaveTextContent('Buy 10 @ ₹1,520.00');
    expect(await screen.findByText('Order modified')).toBeInTheDocument();
  });

  it('a refused modify puts the line back at the real price and says why', async () => {
    const { calls } = await setup([limit()]);
    const handle = handleFor('ord_1');
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 160);
    pointer(handle, 'pointerup', 160);
    await act(async () => calls[0]?.answer.reject(new Error('refused')));
    await waitFor(() => expect(handleFor('ord_1')).toHaveTextContent('Buy 10 @ ₹1,500.00'));
    expect(await screen.findByText('Order not modified')).toBeInTheDocument();
  });

  it('a fill during the drag ends it, puts nothing on the wire and says it filled first', async () => {
    const { store, calls } = await setup([limit()]);
    const handle = handleFor('ord_1');
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 160);
    act(() => {
      store.applyOrder(limit({ status: 'EXECUTED', filledQty: 10, avgFillPrice: 149_995, seq: 2 }));
      store.flush();
    });
    await waitFor(() => expect(screen.queryByTestId('chart-handle')).not.toBeInTheDocument());
    expect(useOrderDraftStore.getState().draft).toBeNull();
    expect(await screen.findByText('Filled at ₹1,499.95 before your change')).toBeInTheDocument();
    pointer(handle, 'pointerup', 160);
    expect(calls).toEqual([]);
  });

  it('cancels with two taps on × within 3 seconds; one tap alone disarms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = await setup([limit()]);
    const cross = () => screen.getByTestId('chart-handle-action');
    expect(cross()).toHaveAccessibleName('Cancel the buy limit for 10 at ₹1,500.00');
    fireEvent.click(cross());
    expect(cross()).toHaveTextContent('Cancel?');
    act(() => vi.advanceTimersByTime(CANCEL_ARM_MS + 1));
    expect(cross()).toHaveTextContent('×');
    expect(calls).toEqual([]);

    fireEvent.click(cross());
    fireEvent.click(cross());
    expect(calls.map((call) => [call.route, call.args])).toEqual([
      ['orderCancel', { params: { id: 'ord_1' } }],
    ]);
    await act(async () => calls[0]?.answer.resolve(limit({ status: 'CANCELLED', seq: 2 })));
    await waitFor(() => expect(screen.queryByTestId('chart-handle')).not.toBeInTheDocument());
    expect(await screen.findByText('Order cancelled')).toBeInTheDocument();
  });
});

describe('ghost line (T15, SPEC-TFC-1 §8.2)', () => {
  it('a gutter tap draws a ghost at that price; dragging moves it and the price follows', async () => {
    await setup([]);
    expect(screen.queryByTestId('chart-handle')).not.toBeInTheDocument();
    const gutter = screen.getByTestId('chart-gutter');
    pointer(gutter, 'pointerdown', 100);
    pointer(gutter, 'pointerup', 100);
    const ghost = screen.getByTestId('chart-handle');
    expect(ghost).toHaveTextContent('New order @ ₹1,550.00');
    expect(series()?.priceLines[0]?.options).toMatchObject({ price: 155_000, lineStyle: 2 });

    pointer(ghost, 'pointerdown', 100);
    pointer(ghost, 'pointermove', 80);
    expect(ghost).toHaveTextContent('New order @ ₹1,560.00');
    pointer(ghost, 'pointerup', 80);
    expect(ghost).toHaveTextContent('New order @ ₹1,560.00');

    // A second finger mid-drag restores the saved price.
    pointer(ghost, 'pointerdown', 80);
    pointer(ghost, 'pointermove', 40);
    expect(ghost).toHaveTextContent('New order @ ₹1,580.00');
    pointer(ghost, 'pointerdown', 10, 2);
    expect(ghost).toHaveTextContent('New order @ ₹1,560.00');

    fireEvent.keyDown(ghost, { key: 'Delete' });
    expect(screen.queryByTestId('chart-handle')).not.toBeInTheDocument();
    expect(series()?.priceLines).toEqual([]);
  });
});
