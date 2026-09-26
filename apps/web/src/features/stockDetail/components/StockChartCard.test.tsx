import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
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

describe('live 1D chart (T-108)', () => {
  // The market is open (forced), so the 1D bars follow the quote store.
  const open = { clock: fixedClock(fromIst(2026, 9, 25, 15 * 60)), alwaysOpen: true };

  async function renderLive(url: string, marketSession = open) {
    const quotes = createTestQuoteStore();
    renderApp(url, { apiClient: api.apiClient, quoteStore: quotes.store, marketSession });
    await screen.findByTestId('chart-host');
    const series = await waitFor(() => {
      const found = chartsMock.active()[0]?.series[0];
      expect(found?.setData).toHaveBeenCalled();
      return found;
    });
    const data = series?.setData.mock.lastCall?.[0] as { time: number; value: number }[];
    const last = data[data.length - 1] as { time: number; value: number };
    return { quotes, series, last };
  }

  it('a tick in the same minute updates the last bar and the next minute appends one', async () => {
    const { quotes, series, last } = await renderLive('/stocks/INFY');
    const setDataCalls = series?.setData.mock.calls.length;
    const inMinute = new Date(last.time * 1000 + 30_000).toISOString();
    act(() => quotes.push(testQuote('INFY', 151235, { ts: inMinute })));
    expect(series?.update).toHaveBeenLastCalledWith({ time: last.time, value: 151235 });

    const nextMinute = new Date(last.time * 1000 + 65_000).toISOString();
    act(() => quotes.push(testQuote('INFY', 151300, { ts: nextMinute })));
    expect(series?.update).toHaveBeenLastCalledWith({ time: last.time + 60, value: 151300 });
    // Updated in place: no full redraw.
    expect(series?.setData.mock.calls.length).toBe(setDataCalls);
  });

  it('stays still on other ranges and while the market is closed', async () => {
    const { quotes, series, last } = await renderLive('/stocks/INFY?range=1W');
    act(() =>
      quotes.push(
        testQuote('INFY', 151235, { ts: new Date(last.time * 1000 + 1_000).toISOString() }),
      ),
    );
    expect(series?.update).not.toHaveBeenCalled();
  });

  it('does not follow ticks on 1D when the market is closed', async () => {
    const closed = { clock: fixedClock(fromIst(2026, 9, 25, 16 * 60)), alwaysOpen: false };
    const { quotes, series, last } = await renderLive('/stocks/INFY', closed);
    act(() =>
      quotes.push(
        testQuote('INFY', 151235, { ts: new Date(last.time * 1000 + 1_000).toISOString() }),
      ),
    );
    expect(series?.update).not.toHaveBeenCalled();
  });
});
