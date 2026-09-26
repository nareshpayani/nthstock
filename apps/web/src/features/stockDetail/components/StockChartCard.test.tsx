import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
});

const candleRanges = () =>
  api.requestsTo('/INFY/candles').map((url) => url.searchParams.get('range'));

describe('stock price chart (T-107)', () => {
  it('opens on the 1D area chart when the URL names no range', async () => {
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('figure', { name: 'INFY area chart over 1 day' }),
    ).toBeInTheDocument();
    await screen.findByTestId('chart-host');
    expect(chartsMock.active()[0]?.series[0]?.type).toBe('Area');
    expect(candleRanges()).toEqual(['1D']);
  });

  it('changing range updates the URL and refetches the candles for that range', async () => {
    const { router } = renderApp('/stocks/INFY?range=1Y', { apiClient: api.apiClient });
    await screen.findByRole('figure', { name: 'INFY area chart over 1 year' });
    expect(screen.getByRole('radio', { name: '1Y' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: '5Y' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '5Y' }));
    await waitFor(() => expect(candleRanges()).toContain('5Y'));
    expect(
      await screen.findByRole('figure', { name: 'INFY area chart over 5 years' }),
    ).toBeInTheDocument();
  });

  it('the area/candle toggle is kept in the URL and swaps the series', async () => {
    const { router } = renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    fireEvent.click(screen.getByRole('radio', { name: 'Candles' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ chart: 'candle' }));
    expect(
      await screen.findByRole('figure', { name: 'INFY candlestick chart over 1 day' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Candlestick'));
  });

  it('the crosshair tooltip shows the IST time and en-IN grouped rupees', async () => {
    renderApp('/stocks/INFY?range=1W', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    // 25 Sep 2026, 14:05 IST.
    const time = Date.parse('2026-09-25T08:35:00.000Z') / 1000;
    act(() => chartsMock.moveCrosshair({ time, value: 12345678 }));
    const tooltip = screen.getByTestId('chart-tooltip');
    expect(tooltip).toHaveTextContent('25 Sept, 14:05');
    expect(tooltip).toHaveTextContent('Price₹1,23,456.78');
    act(() => chartsMock.moveCrosshair(null));
    expect(screen.queryByTestId('chart-tooltip')).not.toBeInTheDocument();
  });

  it('shows candle OHLC in the tooltip', async () => {
    renderApp('/stocks/INFY?range=1Y&chart=candle', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    const time = Date.parse('2026-09-24T18:30:00.000Z') / 1000;
    act(() =>
      chartsMock.moveCrosshair({ time, open: 150000, high: 152500, low: 149050, close: 151235 }),
    );
    const tooltip = screen.getByTestId('chart-tooltip');
    expect(tooltip).toHaveTextContent('25 Sept 2026');
    expect(tooltip).toHaveTextContent('High₹1,525.00');
    expect(tooltip).toHaveTextContent('Close₹1,512.35');
  });
});
