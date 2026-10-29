import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type { CandleInterval, CandleRange } from '@nthstock/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import type { PriceChartType } from '../model/chartTypes';
import { IndexChartCard } from './IndexChartCard';

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

// Friday 25 Sep 2026, 11:00 IST (open) and Friday 2 Oct 2026, 11:00 IST (Gandhi Jayanti).
const tradingClock = fixedClock(fromIst(2026, 9, 25, 11 * 60));
const holidayClock = fixedClock(fromIst(2026, 10, 2, 11 * 60));

function Harness({ initial = '1Y' as CandleRange }) {
  const [range, setRange] = useState<CandleRange>(initial);
  const [interval, setInterval] = useState<CandleInterval | undefined>();
  const [chartType, setChartType] = useState<PriceChartType | undefined>();
  return (
    <IndexChartCard
      range={range}
      interval={interval}
      {...(chartType ? { chartType } : {})}
      onRangeChange={(next) => {
        setRange(next);
        setInterval(undefined);
      }}
      onIntervalChange={setInterval}
      onChartTypeChange={setChartType}
    />
  );
}

function renderCard(clock = tradingClock, initial?: CandleRange) {
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(<Harness {...(initial ? { initial } : {})} />, {
    apiClient: api.apiClient,
    quoteStore: quotes.store,
    marketSession: { clock, alwaysOpen: false },
  });
  return { ...view, quotes };
}

describe('IndexChartCard (T-095)', () => {
  it('draws the NIFTY 50 line chart for the range and shows the live level and change', async () => {
    const { quotes } = renderCard();
    expect(await screen.findByRole('heading', { name: /NIFTY 50/ })).toBeInTheDocument();
    await screen.findByTestId('chart-host');
    expect(screen.getByRole('figure', { name: 'NIFTY 50 line chart over 1 year' })).toBeVisible();
    expect(chartsMock.charts[0]?.series[0]?.setData).toHaveBeenCalled();
    expect(api.requestsTo('/NIFTY50/candles').map((u) => u.searchParams.get('range'))).toEqual([
      '1Y',
    ]);
    act(() => quotes.push(testQuote('NIFTY50', 2541860, { prevClose: 2520615 })));
    expect(screen.getByText('25,418.60')).toBeInTheDocument();
    expect(screen.getByText('+212.45, up 0.84 percent')).toBeInTheDocument();
  });

  it('shows the LIVE badge beside the heading while NSE is open', async () => {
    renderCard(tradingClock);
    // The badge is not part of the heading, so the section keeps the plain name "NIFTY 50".
    expect(await screen.findByRole('heading', { name: 'NIFTY 50' })).toBeInTheDocument();
    expect(screen.getByTitle(/market is open/i)).toHaveTextContent(/Live/);
  });

  it('hides the LIVE badge on a holiday clock', async () => {
    renderCard(holidayClock);
    await screen.findByRole('heading', { name: 'NIFTY 50' });
    expect(screen.queryByTitle(/market is open/i)).not.toBeInTheDocument();
  });

  it('switching range refetches the candles for that range', async () => {
    renderCard();
    await screen.findByTestId('chart-host');
    fireEvent.click(screen.getByRole('radio', { name: '1D' }));
    await waitFor(() =>
      expect(api.requestsTo('/NIFTY50/candles').map((u) => u.searchParams.get('range'))).toEqual([
        '1Y',
        '1D',
      ]),
    );
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(chartsMock.charts.at(-1)?.series[0]?.setData).toHaveBeenCalled());
  });

  it('shows an inline error with a retry when the candles fail', async () => {
    const { http, HttpResponse } = await import('msw');
    api.server.use(
      http.get('*/v1/market/instruments/:symbol/candles', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderCard();
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart unavailable');
    api.server.resetHandlers();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByTestId('chart-host');
  });

  const press = (
    plot: HTMLElement,
    down: { x?: number; id?: number; button?: number; at?: number; type?: string },
    up: { x?: number; id?: number; at?: number } = {},
  ) => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(down.at ?? 0);
    fireEvent.pointerDown(plot, {
      pointerId: down.id ?? 1,
      isPrimary: true,
      pointerType: down.type ?? 'mouse',
      button: down.button ?? 0,
      clientX: down.x ?? 100,
      clientY: 50,
    });
    now.mockReturnValue(up.at ?? down.at ?? 0);
    fireEvent.pointerUp(plot, {
      pointerId: up.id ?? down.id ?? 1,
      pointerType: down.type ?? 'mouse',
      button: down.button ?? 0,
      clientX: up.x ?? down.x ?? 100,
      clientY: 50,
    });
    now.mockRestore();
  };
  /** The plot, 600 px wide with the 64 px price axis at its right edge. */
  const plotOf = () => {
    const plot = screen.getByTestId('dashboard-chart');
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 600,
      top: 0,
      bottom: 260,
      width: 600,
      height: 260,
    } as DOMRect);
    return plot;
  };
  const stillOnDashboard = async (router: { state: { location: { pathname: string } } }) => {
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(router.state.location.pathname).toBe('/');
  };

  it('the chart pans and zooms with the wheel and a pinch (NSTOCK-0437)', async () => {
    renderCard();
    await screen.findByTestId('chart-host');
    expect(chartsMock.charts[0]?.options).toMatchObject({
      handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true },
    });
  });

  it('the zoom buttons narrow and widen the bars on screen (NSTOCK-0437)', async () => {
    renderCard();
    await screen.findByTestId('chart-host');
    const chart = chartsMock.charts[0];
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom in' }));
    expect(chart?.logicalRange).toEqual({ from: 20, to: 60 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(chart?.logicalRange).toEqual({ from: 0, to: 60 });
  });

  it('reset fits the whole range again (NSTOCK-0437)', async () => {
    renderCard();
    await screen.findByTestId('chart-host');
    fireEvent.click(await screen.findByRole('button', { name: 'Reset zoom' }));
    expect(chartsMock.charts[0]?.fitContent).toHaveBeenCalled();
  });

  it('a tap on the chart opens the NIFTY 50 page on the same range (NSTOCK-0437)', async () => {
    const { router } = renderCard();
    await screen.findByTestId('chart-host');
    press(plotOf(), { x: 100, at: 0 }, { x: 102, at: 120 });
    expect(await screen.findByRole('heading', { name: 'Stock NIFTY50' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ exchange: 'NSE', range: '1Y', chart: 'line' });
  });

  it('a touch tap opens the page after the double-tap window, not at once (NSTOCK-0452)', async () => {
    const { router } = renderCard();
    await screen.findByTestId('chart-host');
    press(plotOf(), { x: 100, at: 0, type: 'touch' }, { x: 101, at: 80 });
    await stillOnDashboard(router);
    expect(await screen.findByRole('heading', { name: 'Stock NIFTY50' })).toBeInTheDocument();
  });

  it('a second press inside the double-tap window cancels the open, so the zoom can start (NSTOCK-0452)', async () => {
    const { router } = renderCard();
    await screen.findByTestId('chart-host');
    const plot = plotOf();
    press(plot, { x: 100, at: 0, type: 'touch' }, { x: 101, at: 80 });
    // The second press of a double-tap goes down and is held for the slide.
    fireEvent.pointerDown(plot, {
      pointerId: 2,
      isPrimary: true,
      pointerType: 'touch',
      button: 0,
      clientX: 102,
      clientY: 50,
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(router.state.location.pathname).toBe('/');
  });

  it('opens as a line of 1-minute bars on 1D and offers every 1D bar size (NSTOCK-0443)', async () => {
    renderCard(tradingClock, '1D');
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chart type: Line' })).toBeInTheDocument();
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Line'));
    const sizes = screen.getByRole('radiogroup', { name: 'Bar size' });
    expect(
      within(sizes)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['1m', '5m', '15m', '30m', '1h']);
    expect(within(sizes).getByRole('radio', { name: '1-minute bars' })).toBeChecked();
  });

  it('a bar size refetches those bars and the tap carries it and the type (NSTOCK-0443)', async () => {
    const { router } = renderCard(tradingClock, '1D');
    await screen.findByTestId('chart-host');
    fireEvent.click(screen.getByRole('radio', { name: '5-minute bars' }));
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day, 5-minute bars' }),
    ).toBeInTheDocument();
    expect(api.requestsTo('/NIFTY50/candles').map((u) => u.searchParams.get('interval'))).toEqual([
      '1m',
      '5m',
    ]);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chart type: Line' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Candles/ }));
    expect(
      await screen.findByRole('figure', {
        name: 'NIFTY 50 candlestick chart over 1 day, 5-minute bars',
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Candlestick'));
    press(plotOf(), { x: 100 });
    await screen.findByRole('heading', { name: 'Stock NIFTY50' });
    expect(router.state.location.search).toEqual({
      exchange: 'NSE',
      range: '1D',
      chart: 'candle',
      interval: '5m',
    });
  });

  it('a drag, a long press, another button or a cancelled press does not open it (NSTOCK-0437)', async () => {
    const { router } = renderCard();
    await screen.findByTestId('chart-host');
    const plot = plotOf();
    press(plot, { x: 100 }, { x: 160 });
    press(plot, { at: 0 }, { at: 800 });
    press(plot, { button: 2 });
    fireEvent.pointerDown(plot, { pointerId: 1, button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerCancel(plot, { pointerId: 1 });
    fireEvent.pointerUp(plot, { pointerId: 1, button: 0, clientX: 100, clientY: 50 });
    await stillOnDashboard(router);
  });

  it('a tap on the price axis does not open it (NSTOCK-0437)', async () => {
    const { router } = renderCard();
    await screen.findByTestId('chart-host');
    press(plotOf(), { x: 580 });
    await stillOnDashboard(router);
  });

  it('a press that ended off the plot does not block the next tap (NSTOCK-0437)', async () => {
    renderCard();
    await screen.findByTestId('chart-host');
    const plot = plotOf();
    fireEvent.pointerDown(plot, { pointerId: 1, isPrimary: true, button: 0, clientX: 100 });
    press(plot, { id: 2, x: 100 });
    expect(await screen.findByRole('heading', { name: 'Stock NIFTY50' })).toBeInTheDocument();
  });

  it('a pinch (a second finger down) does not open it (NSTOCK-0437)', async () => {
    const { router } = renderCard();
    await screen.findByTestId('chart-host');
    const plot = plotOf();
    fireEvent.pointerDown(plot, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 50,
    });
    fireEvent.pointerDown(plot, { pointerId: 2, button: 0, clientX: 200, clientY: 50 });
    fireEvent.pointerUp(plot, { pointerId: 2, button: 0, clientX: 200, clientY: 50 });
    fireEvent.pointerUp(plot, { pointerId: 1, button: 0, clientX: 100, clientY: 50 });
    await stillOnDashboard(router);
  });

  it('the title links to the NIFTY 50 page', async () => {
    renderCard();
    expect(await screen.findByRole('link', { name: 'NIFTY 50' })).toHaveAttribute(
      'href',
      '/stocks/NIFTY50?exchange=NSE&range=1Y&chart=line',
    );
  });

  it('the title link carries a picked bar size and type (NSTOCK-0443)', async () => {
    renderCard(tradingClock, '1D');
    await screen.findByTestId('chart-host');
    fireEvent.click(screen.getByRole('radio', { name: '30-minute bars' }));
    await screen.findByRole('figure', { name: /30-minute bars/ });
    expect(screen.getByRole('link', { name: 'NIFTY 50' })).toHaveAttribute(
      'href',
      '/stocks/NIFTY50?exchange=NSE&range=1D&chart=line&interval=30m',
    );
  });

  it('hides the bar size on a one-size range or without a handler (NSTOCK-0443)', async () => {
    renderCard(tradingClock, '5Y');
    await screen.findByTestId('chart-host');
    expect(screen.queryByRole('radiogroup', { name: 'Bar size' })).not.toBeInTheDocument();
    renderWithProviders(<IndexChartCard range="1D" onRangeChange={() => undefined} />, {
      apiClient: api.apiClient,
      quoteStore: createTestQuoteStore().store,
      marketSession: { clock: tradingClock, alwaysOpen: false },
    });
    await waitFor(() => expect(screen.getAllByTestId('chart-host')).toHaveLength(2));
    expect(screen.queryByRole('radiogroup', { name: 'Bar size' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Bar size' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Chart type: / })).toHaveLength(1);
  });

  it('on a phone the bar size is a 44 px select beside a 44 px type button (NSTOCK-0443)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 767.98px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderCard(tradingClock, '1D');
    await screen.findByTestId('chart-host');
    expect(screen.queryByRole('radiogroup', { name: 'Bar size' })).not.toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Bar size' });
    expect(select).toHaveValue('1m');
    expect(select).toHaveClass('h-11');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1m', '5m', '15m', '30m', '1h']);
    expect(screen.getByRole('button', { name: 'Chart type: Line' })).toHaveClass('h-11');
    fireEvent.change(select, { target: { value: '15m' } });
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day, 15-minute bars' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bar size' })).toHaveValue('15m');
  });

  it('moves the last bar with the live level, and starts a new one on time (NSTOCK-0441)', async () => {
    const { quotes } = renderCard();
    await screen.findByTestId('chart-host');
    const series = await waitFor(() => {
      const found = chartsMock.active()[0]?.series[0];
      expect(found?.setData).toHaveBeenCalled();
      return found;
    });
    const data = series?.setData.mock.lastCall?.[0] as { time: number; value: number }[];
    const last = data[data.length - 1] as { time: number; value: number };
    // 1Y draws daily bars: a tick on the last bar's day moves it, the next trading day adds one.
    const sameDay = new Date(last.time * 1000 + 60_000).toISOString();
    act(() => quotes.push(testQuote('NIFTY50', 2541860, { ts: sameDay })));
    // A tick on the same bar glides there over a few frames (A16).
    await waitFor(() =>
      expect(series?.update).toHaveBeenLastCalledWith({ time: last.time, value: 2541860 }),
    );
    const nextDay = new Date(last.time * 1000 + 86_400_000).toISOString();
    act(() => quotes.push(testQuote('NIFTY50', 2542000, { ts: nextDay })));
    expect(series?.update).toHaveBeenLastCalledWith({
      time: last.time + 86_400,
      value: 2542000,
    });
  });
});
