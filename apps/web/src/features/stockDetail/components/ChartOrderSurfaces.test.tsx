import { createTradingStore, type ApiClient } from '@nthstock/apiClient';
import type { AccountState, Instrument, Order } from '@nthstock/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartTrading } from '@/features/chartTrading';
import type { ChartHandle } from '@/features/charts';
import { initialOrderDraftState, useOrderDraftStore } from '@/shared/lib/orderDraftStore';
import { AreaSeries, chartsMock, createChart } from '@/test/chartsMock';
import { renderWithProviders } from '@/test/renderWithProviders';
import { InstrumentOrders } from './InstrumentOrders';

const AT = '2026-09-28T04:30:00.000Z';
const instrument: Instrument = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  name: 'Infosys Ltd',
  type: 'EQUITY',
  isin: 'INE009A01021',
  sector: 'Information Technology',
  lotSize: 1,
  tickSize: 5,
};
const order: Order = {
  id: 'ord_1',
  clientOrderId: null,
  token: instrument.token,
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
const account: AccountState = {
  seq: 1,
  orders: [order],
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
};

function pointer(target: Element, type: string, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

afterEach(() => {
  chartsMock.reset();
  useOrderDraftStore.setState(initialOrderDraftState);
});

describe('one price on every surface while an order line moves (T16, TFC-21)', () => {
  it('the phone Orders tab follows the drag, then shows the modify in flight', async () => {
    let answer: ((order: Order) => void) | null = null;
    const api = {
      request: vi.fn(
        () =>
          new Promise<Order>((resolve) => {
            answer = resolve;
          }),
      ),
    } as unknown as ApiClient;
    const store = createTradingStore({
      loadState: () => Promise.resolve(account),
      schedule: (flush) => queueMicrotask(flush),
    });
    await store.start();
    const host = document.createElement('div');
    const chart = createChart(host, {});
    const handle = { chart, series: chart.addSeries(AreaSeries), host } as unknown as ChartHandle;
    renderWithProviders(
      <>
        <ChartTrading handle={handle} instrument={instrument} />
        <InstrumentOrders instrument={instrument} />
      </>,
      { apiClient: api, tradingStore: store },
    );
    const line = await screen.findByTestId('chart-handle');
    expect(screen.queryByTestId('pending-price')).not.toBeInTheDocument();

    // ₹1,600.00 at y = 0 and 50 paise per px: y 160 is ₹1,520.00.
    pointer(line, 'pointerdown', 200);
    pointer(line, 'pointermove', 160);
    expect(await screen.findByTestId('pending-price')).toHaveTextContent('Moving to ₹1,520.00');

    pointer(line, 'pointerup', 160);
    await waitFor(() =>
      expect(screen.getByTestId('pending-price')).toHaveTextContent('Saving at ₹1,520.00'),
    );
    await act(async () => answer?.({ ...order, price: 152_000, seq: 2 }));
    await waitFor(() => expect(screen.queryByTestId('pending-price')).not.toBeInTheDocument());
    expect(screen.getByRole('list', { name: "Today's INFY orders" })).toHaveTextContent(
      '₹1,520.00',
    );
    store.dispose();
  });
});
