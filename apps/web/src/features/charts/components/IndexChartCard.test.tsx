import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { CandleRange } from '@nthstock/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
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
  return <IndexChartCard range={range} onRangeChange={setRange} />;
}

function renderCard(clock = tradingClock) {
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(<Harness />, {
    apiClient: api.apiClient,
    quoteStore: quotes.store,
    marketSession: { clock, alwaysOpen: false },
  });
  return { ...view, quotes };
}

describe('IndexChartCard (T-095)', () => {
  it('draws the NIFTY 50 area chart for the range and shows the live level and change', async () => {
    const { quotes } = renderCard();
    expect(await screen.findByRole('heading', { name: /NIFTY 50/ })).toBeInTheDocument();
    await screen.findByTestId('chart-host');
    expect(screen.getByRole('figure', { name: 'NIFTY 50 area chart over 1 year' })).toBeVisible();
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
      await screen.findByRole('figure', { name: 'NIFTY 50 area chart over 1 day' }),
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
    down: { x?: number; id?: number; button?: number; at?: number },
    up: { x?: number; id?: number; at?: number } = {},
  ) => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(down.at ?? 0);
    fireEvent.pointerDown(plot, {
      pointerId: down.id ?? 1,
      isPrimary: true,
      button: down.button ?? 0,
      clientX: down.x ?? 100,
      clientY: 50,
    });
    now.mockReturnValue(up.at ?? down.at ?? 0);
    fireEvent.pointerUp(plot, {
      pointerId: up.id ?? down.id ?? 1,
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
    expect(router.state.location.search).toEqual({ exchange: 'NSE', range: '1Y' });
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
      '/stocks/NIFTY50?exchange=NSE&range=1Y',
    );
  });
});
