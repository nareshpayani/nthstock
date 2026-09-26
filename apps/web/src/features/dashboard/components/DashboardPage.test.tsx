import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';

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
});

const candleRanges = () =>
  api.requestsTo('/NIFTY50/candles').map((url) => url.searchParams.get('range'));

describe('dashboard URL state', () => {
  it('drops an invalid range from the URL and falls back to 1 year', async () => {
    const { router } = renderApp('/dashboard?range=2Y', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 area chart over 1 year' }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });

  it('reads the chart range from the URL and writes it back when a range is picked', async () => {
    const { router } = renderApp('/dashboard?range=1M', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 area chart over 1 month' }),
    ).toBeInTheDocument();
    expect(candleRanges()).toContain('1M');
    fireEvent.click(screen.getByRole('radio', { name: '5Y' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '5Y' }));
    await waitFor(() => expect(candleRanges()).toContain('5Y'));
  });

  it('opens the curated list named in the URL and writes the tab back', async () => {
    const { router } = renderApp('/dashboard?list=top-it', { apiClient: api.apiClient });
    const tab = await screen.findByRole('tab', { name: 'Top IT' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(api.requests.map((url) => url.pathname)).toContain('/v1/market/lists/top-it'),
    );
    const giants = screen.getByRole('tab', { name: 'Market Giants' });
    fireEvent.mouseDown(giants);
    await waitFor(() => expect(router.state.location.search).toEqual({ list: 'market-giants' }));
  });
});
