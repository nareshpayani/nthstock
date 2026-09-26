import { formatInr } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession, signIn, signOut } from '@/test/session';

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

async function openStock(url: string) {
  const quotes = createTestQuoteStore();
  const view = renderApp(url, { apiClient: api.apiClient, quoteStore: quotes.store });
  await screen.findByRole('heading', { level: 1 });
  return { ...view, quotes };
}

describe('stock detail header (T-106)', () => {
  it('shows the name, symbol, exchange toggle, snapshot price and day change', async () => {
    await openStock('/stocks/INFY');
    expect(screen.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeInTheDocument();
    const exchange = screen.getByRole('radiogroup', { name: 'Exchange' });
    expect(within(exchange).getByRole('radio', { name: 'NSE' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The mock symbol master lists INFY on NSE only.
    await waitFor(() =>
      expect(within(exchange).getByRole('radio', { name: 'BSE' })).toBeDisabled(),
    );
    expect(await screen.findByText('INFY is not listed on BSE.')).toBeInTheDocument();
    // Before any live tick, the REST snapshot's price shows.
    const snapshot = await api.adapter.getQuote('INFY');
    expect(await screen.findByText(formatInr(snapshot?.ltp ?? 0))).toBeInTheDocument();
  });

  it('shows the live price and change from the quote store, with ▲▼ in the text', async () => {
    const { quotes } = await openStock('/stocks/INFY');
    act(() => quotes.push(testQuote('INFY', 151235, { prevClose: 150000 })));
    expect(screen.getByText('₹1,512.35')).toBeInTheDocument();
    expect(screen.getByText('+₹12.35, up 0.82 percent')).toBeInTheDocument();
    expect(screen.getByText(/▲ 0\.82%/)).toBeInTheDocument();
    expect(quotes.subscribed.get('NSE:INFY')).toBe(1);
  });

  it('clicking Buy when signed in sets ticketIntent to the symbol with side BUY', async () => {
    signIn();
    await openStock('/stocks/INFY');
    fireEvent.click(screen.getByRole('button', { name: 'Buy INFY' }));
    await waitFor(() =>
      expect(useTicketIntentStore.getState().intent).toEqual({
        symbol: 'INFY',
        exchange: 'NSE',
        side: 'BUY',
      }),
    );
    expect(await screen.findByText('Buy INFY')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sell INFY' }));
    await waitFor(() => expect(useTicketIntentStore.getState().intent?.side).toBe('SELL'));
  });

  it('clicking Buy when signed out goes to login with a redirect back, keeping the intent', async () => {
    signOut();
    const { router } = await openStock('/stocks/INFY?range=1M');
    fireEvent.click(screen.getByRole('button', { name: 'Buy INFY' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ redirect: '/stocks/INFY?range=1M' });
    expect(useTicketIntentStore.getState().intent).toEqual({
      symbol: 'INFY',
      exchange: 'NSE',
      side: 'BUY',
    });
  });

  it('has no Buy or Sell for an index, and SENSEX opens on BSE', async () => {
    await openStock('/stocks/SENSEX');
    expect(screen.getByRole('heading', { level: 1, name: 'SENSEX' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buy/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'BSE' })).toHaveAttribute('aria-checked', 'true');
  });
});
