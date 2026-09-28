import { screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
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
  document.title = 'nthstock';
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
});

describe('stock detail route (T-105)', () => {
  it('/stocks/INFY loads the instrument and sets the page title', async () => {
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Infosys Ltd' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Infosys Ltd (INFY) · nthstock');
    // The page loader asks once; the exchange toggle's lookup of BSE is a separate request.
    const loads = api.requestsTo('/instruments/INFY').filter((url) => !url.search);
    expect(loads).toHaveLength(1);
  });

  it('orders the sections chart, depth, key stats, overview for an equity (T-112)', async () => {
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await screen.findByRole('region', { name: 'Overview' });
    const main = screen.getByRole('main');
    const titles = ['Price chart', 'Market depth', 'Key stats', 'Overview'];
    const names = within(main)
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-labelledby'))
      .map((id) => (id ? document.getElementById(id)?.textContent : null))
      .filter((text): text is string => Boolean(text))
      // During NSE hours the chart heading also holds the LIVE badge's text, so match by prefix.
      .map((text) => titles.find((title) => text.startsWith(title)) ?? text);
    expect(names).toEqual(titles);
  });

  it('/stocks/NOPE shows not-found with the symbol and a way back', async () => {
    renderApp('/stocks/NOPE', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Stock not found' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/We could not find NOPE/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(document.title).toBe('Stock not found · nthstock');
  });

  it('treats a string that cannot be a symbol as not found', async () => {
    renderApp('/stocks/NOT%20A%20SYMBOL', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Stock not found' }),
    ).toBeInTheDocument();
  });

  it('redirects a lower-case symbol to the upper-case URL', async () => {
    const { router } = renderApp('/stocks/infy?range=1M', { apiClient: api.apiClient });
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/INFY'));
    expect(router.state.location.search).toEqual({ range: '1M' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Infosys Ltd' }),
    ).toBeInTheDocument();
  });

  it('shows the route error state with a retry when the API cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderApp('/stocks/INFY');
    expect(await screen.findByRole('alert')).toHaveTextContent('This page could not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
