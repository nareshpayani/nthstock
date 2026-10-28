import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_API_ORIGIN } from '@/mocks/node';
import { useConnectivityStore } from '@/shared/lib/connectivity';
import { registerSimulator } from '@/shared/lib/demoSimulator';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore } from '@/test/quotes';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';

vi.mock('lightweight-charts', () => import('@/test/chartsMock'));

const api = createMockApi();
beforeAll(() => api.listen());
afterEach(() => api.reset());
afterAll(() => api.close());
beforeEach(() => {
  installResizeObserver();
  chartsMock.reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
  registerSimulator(null);
  useConnectivityStore.setState({
    browserOffline: false,
    socketDown: false,
    since: null,
    forced: 'live',
  });
});

async function openStock() {
  const quotes = createTestQuoteStore();
  renderApp('/stocks/INFY', { apiClient: api.apiClient, quoteStore: quotes.store });
  await screen.findByRole('heading', { level: 1, name: 'Infosys Ltd' });
  await screen.findByRole('figure');
}
const force = (
  state: Parameters<ReturnType<typeof useConnectivityStore.getState>['setForced']>[0],
) =>
  act(() => {
    useConnectivityStore.getState().setForced(state);
  });

describe('page states (CR-T18, SPEC-CR-1 §7)', () => {
  it('loading: the price block and the chart show skeletons', async () => {
    await openStock();
    force('loading');
    expect(screen.getByTestId('price-loading')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('empty: a day with no trades says so', async () => {
    await openStock();
    force('empty');
    expect(await screen.findByText('No trades yet today')).toBeInTheDocument();
  });

  it('error: "Price unavailable" with Retry, and the chart error with retry', async () => {
    await openStock();
    force('error');
    const price = screen.getByTestId('price-unavailable');
    expect(price).toHaveTextContent('Price unavailable');
    expect(within(price).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('Chart unavailable')).toBeInTheDocument();
  });

  it('offline: the last price is marked stale with its time, and the chart is paused', async () => {
    await openStock();
    force('offline');
    expect(screen.getByTestId('price-stale')).toHaveTextContent(/^Stale · as of \d{2}:\d{2}/);
    expect(screen.getByTestId('chart-paused')).toHaveTextContent('Paused: offline');
    // The last candles stay on screen.
    expect(screen.getByRole('figure')).toBeInTheDocument();
    force('live');
    expect(screen.queryByTestId('price-stale')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-paused')).not.toBeInTheDocument();
  });

  it('a snapshot that fails with no live price shows "Price unavailable", and Retry asks again', async () => {
    let calls = 0;
    api.server.use(
      http.get(`${TEST_API_ORIGIN}/v1/market/quotes`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const quotes = createTestQuoteStore();
    renderApp('/stocks/INFY', { apiClient: api.apiClient, quoteStore: quotes.store });
    const price = await screen.findByTestId('price-unavailable', {}, { timeout: 8_000 });
    const before = calls;
    await userEvent.setup().click(within(price).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it('the demo States row shows each state, and leaving the page goes back to live', async () => {
    registerSimulator({
      rally: vi.fn(() => Promise.resolve(true)),
      pullBack: vi.fn(() => Promise.resolve(true)),
      gapDown: vi.fn(() => Promise.resolve(true)),
      setSplitFills: vi.fn(() => Promise.resolve()),
      splitFills: vi.fn(() => false),
    });
    await openStock();
    const states = screen.getByRole('group', { name: 'Show the page in a state' });
    const user = userEvent.setup();
    expect(within(states).getByRole('button', { name: 'Live' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(states).getByRole('button', { name: 'Offline' }));
    expect(useConnectivityStore.getState().forced).toBe('offline');
    expect(within(states).getByRole('button', { name: 'Offline' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('chart-paused')).toBeInTheDocument();
    await user.click(within(states).getByRole('button', { name: 'Live' }));
    expect(screen.queryByTestId('chart-paused')).not.toBeInTheDocument();
  });

  it('leaving the page puts a forced state back to live', async () => {
    registerSimulator({
      rally: vi.fn(() => Promise.resolve(true)),
      pullBack: vi.fn(() => Promise.resolve(true)),
      gapDown: vi.fn(() => Promise.resolve(true)),
      setSplitFills: vi.fn(() => Promise.resolve()),
      splitFills: vi.fn(() => false),
    });
    const quotes = createTestQuoteStore();
    const view = renderApp('/stocks/INFY', { apiClient: api.apiClient, quoteStore: quotes.store });
    await screen.findByRole('figure');
    force('offline');
    expect(useConnectivityStore.getState().forced).toBe('offline');
    view.unmount();
    expect(useConnectivityStore.getState().forced).toBe('live');
  });
});
