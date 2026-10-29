import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChartStudies } from '@/features/charts';
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
  window.localStorage.clear();
  useChartStudies.setState({ studies: ['volume'] });
});

const candleRanges = () =>
  api.requestsTo('/INFY/candles').map((url) => url.searchParams.get('range'));

describe('stock price chart (T-107)', () => {
  it('an index chart, which has no trading, still pans and zooms (NSTOCK-0437)', async () => {
    renderApp('/stocks/NIFTY50', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]).toBeDefined());
    expect(chartsMock.active()[0]?.options).toMatchObject({
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true },
    });
    expect(screen.queryByTestId('chart-overlay')).not.toBeInTheDocument();
  });

  it('the zoom buttons narrow, widen and reset the bars on screen, and are absent while loading (NSTOCK-0452)', async () => {
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    // Loading: the skeleton shows and there are no zoom buttons yet.
    expect(screen.queryByRole('group', { name: 'Zoom' })).not.toBeInTheDocument();
    await screen.findByTestId('chart-host');
    const chart = await waitFor(() => {
      const found = chartsMock.active()[0];
      expect(found).toBeDefined();
      return found;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom in' }));
    expect(chart?.logicalRange).toEqual({ from: 20, to: 60 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(chart?.logicalRange).toEqual({ from: 0, to: 60 });
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(chart?.fitContent).toHaveBeenCalled();
  });

  it('has no zoom buttons when the candles fail (NSTOCK-0452)', async () => {
    const { http, HttpResponse } = await import('msw');
    api.server.use(
      http.get('*/v1/market/instruments/:symbol/candles', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart unavailable');
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-zoom')).not.toBeInTheDocument();
  });

  it('full screen holds the one chart, with the rail, the trading lines and the bar size; Close returns (NSTOCK-0461)', async () => {
    const { router } = renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    const resizer = installResizeObserver();
    const open = await screen.findByRole('button', { name: 'Open the chart full screen' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'INFY chart' });
    act(() => resizer.resize(800, 400));
    await within(dialog).findByTestId('chart-host');
    // The page chart is gone while full screen is open: one chart, one home for the lines.
    await waitFor(() => expect(chartsMock.active()).toHaveLength(1));
    expect(within(dialog).getByTestId('chart-overlay')).toBeInTheDocument();
    expect(within(dialog).getByRole('toolbar', { name: 'Drawing tools' })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('combobox', { name: /bar size/i }), {
      target: { value: '15m' },
    });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ interval: '15m' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close full screen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('on a phone, Draw opens the full-screen chart with the rail (NSTOCK-0461)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.startsWith('(max-width: 767.98px)'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    expect(screen.queryByRole('toolbar', { name: 'Drawing tools' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Draw/ }));
    const dialog = screen.getByRole('dialog', { name: 'INFY chart' });
    expect(within(dialog).getByRole('toolbar', { name: 'Drawing tools' })).toBeInTheDocument();
  });

  it('opens on the 1D area chart when the URL names no range', async () => {
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('figure', { name: 'INFY area chart over 1 day' }),
    ).toBeInTheDocument();
    await screen.findByTestId('chart-host');
    // The charts library loads lazily, so the series can come a moment after the host.
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Area'));
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

  it('the chart type menu offers five types, keeps the choice in the URL and swaps the series (NSTOCK-0430)', async () => {
    const { router } = renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    const pick = async (name: RegExp) => {
      fireEvent.keyDown(screen.getByRole('button', { name: /^Chart type: / }), { key: 'Enter' });
      fireEvent.click(await screen.findByRole('menuitemradio', { name }));
    };
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chart type: Area' }), { key: 'Enter' });
    expect((await screen.findAllByRole('menuitemradio')).map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Line/),
      expect.stringMatching(/^Area/),
      expect.stringMatching(/^Candles/),
      expect.stringMatching(/^OHLC/),
      expect.stringMatching(/^Heikin-Ashi.*Not traded prices/),
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Candles/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ chart: 'candle' }));
    expect(
      await screen.findByRole('figure', { name: 'INFY candlestick chart over 1 day' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Candlestick'));

    await pick(/^OHLC/);
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Bar'));
    await pick(/^Line/);
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Line'));
    await pick(/^Heikin-Ashi/);
    expect(
      await screen.findByRole('figure', {
        name: 'INFY Heikin-Ashi (smoothed) chart over 1 day',
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Candlestick'));
    // Remembered for the next visit that names no type.
    expect(window.localStorage.getItem('nthstock.chartType')).toBe('heikin');
  });

  it('opens on the remembered type when the URL names none, and the URL wins over it (NSTOCK-0430)', async () => {
    window.localStorage.setItem('nthstock.chartType', 'bar');
    const first = renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Bar'));
    first.unmount();

    renderApp('/stocks/INFY?chart=line', { apiClient: api.apiClient });
    await waitFor(() => expect(chartsMock.active().at(-1)?.series[0]?.type).toBe('Line'));
  });

  it('ignores an invalid remembered type and opens on area (NSTOCK-0430)', async () => {
    window.localStorage.setItem('nthstock.chartType', 'renko');
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Area'));
  });

  it('the Heikin-Ashi tooltip shows the traded prices, not the smoothed ones (NSTOCK-0430)', async () => {
    renderApp('/stocks/INFY?range=1Y&chart=heikin', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    const series = await waitFor(() => {
      const found = chartsMock.active()[0]?.series[0];
      expect(found?.setData).toHaveBeenCalled();
      return found;
    });
    const drawn = series?.setData.mock.lastCall?.[0] as { time: number }[];
    const time = drawn[3]?.time as number;
    // A smoothed bar that no traded candle matches.
    act(() =>
      chartsMock.moveCrosshair({ time, open: 999900, high: 999900, low: 999900, close: 999900 }),
    );
    // The legend shows the real candle at that time, not the smoothed bar.
    const legend = screen.getByTestId('chart-legend');
    expect(legend).toHaveTextContent('H');
    expect(legend).not.toHaveTextContent('9,999.00');
  });

  it('draws volume by default and a picked indicator adds a line (NSTOCK-0460)', async () => {
    renderApp('/stocks/INFY?range=1Y', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    const count = (type: string) =>
      chartsMock.active()[0]?.series.filter((s) => s.type === type).length ?? 0;
    await waitFor(() => expect(count('Histogram')).toBe(1));
    const lines = count('Line');
    fireEvent.keyDown(screen.getByRole('button', { name: /^Indicators/ }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Moving average 20/ }));
    await waitFor(() => expect(count('Line')).toBe(lines + 1));
  });

  it('offers 1m to 1h bars on 1D, keeps the choice in the URL and fetches those bars (NSTOCK-0343)', async () => {
    const { router } = renderApp('/stocks/INFY', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    const bars = screen.getByRole('radiogroup', { name: 'Bar size' });
    expect(
      within(bars)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['1m', '5m', '15m', '30m', '1h']);
    expect(within(bars).getByRole('radio', { name: '1-minute bars' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(within(bars).getByRole('radio', { name: '15-minute bars' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ interval: '15m' }));
    expect(
      await screen.findByRole('figure', { name: 'INFY area chart over 1 day, 15-minute bars' }),
    ).toBeInTheDocument();
    const intervals = api
      .requestsTo('/INFY/candles')
      .map((url) => url.searchParams.get('interval'));
    expect(intervals).toContain('15m');

    // 1W offers 15-minute bars too, so the choice stays; 1Y does not, so it falls back to days.
    fireEvent.click(screen.getByRole('radio', { name: '1W' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ range: '1W', interval: '15m' }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '1Y' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '1Y' }));
    expect(
      within(screen.getByRole('radiogroup', { name: 'Bar size' })).getByRole('radio', {
        name: 'daily bars',
      }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('hides the bar size picker on 5Y, which has weekly bars only', async () => {
    renderApp('/stocks/INFY?range=5Y', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    expect(screen.queryByRole('radiogroup', { name: 'Bar size' })).not.toBeInTheDocument();
  });

  it('the legend follows the crosshair with en-IN grouped values, and rests on the last bar (NSTOCK-0460)', async () => {
    renderApp('/stocks/INFY?range=1Y&chart=candle', { apiClient: api.apiClient });
    await screen.findByTestId('chart-host');
    const series = await waitFor(() => {
      const found = chartsMock.active()[0]?.series[0];
      expect(found?.setData).toHaveBeenCalled();
      return found;
    });
    const bars = series?.setData.mock.lastCall?.[0] as {
      time: number;
      high: number;
      close: number;
    }[];
    const legend = screen.getByTestId('chart-legend');
    const last = bars.at(-1);
    expect(legend).toHaveTextContent(`C${formatInr(last?.close ?? 0).slice(1)}`);
    const held = bars[3];
    act(() => chartsMock.moveCrosshair({ ...held, open: 0, low: 0 } as never));
    expect(legend).toHaveTextContent(`H${formatInr(held?.high ?? 0).slice(1)}`);
    expect(legend).toHaveTextContent(`C${formatInr(held?.close ?? 0).slice(1)}`);
    act(() => chartsMock.moveCrosshair(null));
    expect(legend).toHaveTextContent(`C${formatInr(last?.close ?? 0).slice(1)}`);
  });
});

describe('live chart (T-108, NSTOCK-0441)', () => {
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
    // A tick on the same bar glides there over a few frames (A16).
    await waitFor(() =>
      expect(series?.update).toHaveBeenLastCalledWith({ time: last.time, value: 151235 }),
    );

    const nextMinute = new Date(last.time * 1000 + 65_000).toISOString();
    act(() => quotes.push(testQuote('INFY', 151300, { ts: nextMinute })));
    expect(series?.update).toHaveBeenLastCalledWith({ time: last.time + 60, value: 151300 });
    // Updated in place: no full redraw.
    expect(series?.setData.mock.calls.length).toBe(setDataCalls);
  });

  it('on Heikin-Ashi a tick updates only the last smoothed bar, and the tooltip keeps traded prices (NSTOCK-0430)', async () => {
    const { quotes, series } = await renderLive('/stocks/INFY?chart=heikin');
    const drawn = series?.setData.mock.lastCall?.[0] as {
      time: number;
      open: number;
      close: number;
    }[];
    const last = drawn[drawn.length - 1] as { time: number; open: number; close: number };
    const setDataCalls = series?.setData.mock.calls.length;

    // Same minute: one update of the last bar, drawn smoothed (its open is unchanged, its close is
    // the mean of O, H, L, C rather than the traded 151235).
    const inMinute = new Date(last.time * 1000 + 30_000).toISOString();
    act(() => quotes.push(testQuote('INFY', 151235, { ts: inMinute })));
    expect(series?.update).toHaveBeenCalledTimes(1);
    const updated = series?.update.mock.lastCall?.[0] as typeof last;
    expect(updated.time).toBe(last.time);
    expect(updated.open).toBe(last.open);
    expect(updated.close).not.toBe(151235);

    // Next minute: one more update, a new bar after the last.
    const nextMinute = new Date(last.time * 1000 + 65_000).toISOString();
    act(() => quotes.push(testQuote('INFY', 151300, { ts: nextMinute })));
    expect(series?.update).toHaveBeenCalledTimes(2);
    expect((series?.update.mock.lastCall?.[0] as typeof last).time).toBe(last.time + 60);
    // Updated in place: no full redraw.
    expect(series?.setData.mock.calls.length).toBe(setDataCalls);

    // The new bar is hoverable and shows what traded (O = H = L = C = ₹1,513.00), not the smoothed
    // values the chart drew, so the real-price map was refreshed.
    act(() =>
      chartsMock.moveCrosshair({
        time: last.time + 60,
        open: 999900,
        high: 999900,
        low: 999900,
        close: 999900,
      }),
    );
    const legend = screen.getByTestId('chart-legend');
    expect(legend).toHaveTextContent('O1,513.00');
    expect(legend).toHaveTextContent('C1,513.00');
    expect(legend).not.toHaveTextContent('9,999.00');
  });

  it('follows ticks on longer ranges too (NSTOCK-0441)', async () => {
    const { quotes, series, last } = await renderLive('/stocks/INFY?range=1W');
    act(() =>
      quotes.push(
        testQuote('INFY', 151235, { ts: new Date(last.time * 1000 + 1_000).toISOString() }),
      ),
    );
    await waitFor(() => expect(series?.update).toHaveBeenCalled());
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
