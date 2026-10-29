import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore } from '@/test/quotes';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession, signIn } from '@/test/session';

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
  useTicketIntentStore.setState(initialTicketIntentState);
});

async function open(url: string) {
  const quotes = createTestQuoteStore();
  const view = renderApp(url, { apiClient: api.apiClient, quoteStore: quotes.store });
  await screen.findByRole('heading', { level: 1 });
  return view;
}

describe('trading an index through its ETF (NSTOCK-0440)', () => {
  it('shows the fund card with a link to the fund page', async () => {
    await open('/stocks/NIFTY50?exchange=NSE');
    expect(await screen.findByRole('heading', { name: 'Trade NIFTY 50' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View NIFTY 50 ETF' })).toHaveAttribute(
      'href',
      '/stocks/NIFTYETF?exchange=NSE',
    );
  });

  it('Buy ETF opens the order ticket for the fund, not the index', async () => {
    signIn();
    await open('/stocks/NIFTY50?exchange=NSE');
    fireEvent.click(await screen.findByRole('button', { name: 'Buy NIFTY 50 ETF' }));
    await waitFor(() =>
      expect(useTicketIntentStore.getState().intent).toMatchObject({
        symbol: 'NIFTYETF',
        exchange: 'NSE',
        side: 'BUY',
      }),
    );
  });

  it('shows nothing on a stock page', async () => {
    await open('/stocks/INFY');
    expect(screen.queryByTestId('index-etf-card')).not.toBeInTheDocument();
  });
});
