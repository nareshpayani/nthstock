import { fixedClock, fromIst } from '@nthstock/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { resetSession, signIn, testSession } from '@/test/session';
import { HOME_CHART_SYMBOLS } from '../model/dashboardSearch';
import { strings } from '../strings';

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

/** A market session whose clock reads the given IST time on Friday 25 Sep 2026. */
const at = (hour: number) => ({
  clock: fixedClock(fromIst(2026, 9, 25, hour * 60)),
  alwaysOpen: false,
});

const section = (name: string) => screen.getByRole('region', { name });
const linksIn = (name: string) =>
  within(within(section(name)).getByRole('tabpanel')).queryAllByRole('link');

const candleRanges = () =>
  api.requestsTo('/NIFTY50/candles').map((url) => url.searchParams.get('range'));

describe('dashboard URL state', () => {
  it('Home chart Buy and Sell open the ticket for the charted stock, with chart trading on', async () => {
    signIn(testSession());
    renderApp('/dashboard', { apiClient: api.apiClient });
    const home = await screen.findByRole('region', { name: 'Trade HDFCBANK from the chart' });
    // The trading overlay (order lines, drag to price) is on the Home chart (NSTOCK-0476).
    await waitFor(() => expect(home.querySelector('[data-testid="chart-overlay"]')).not.toBeNull());
    fireEvent.click(within(home).getByRole('button', { name: 'Sell HDFCBANK' }));
    await waitFor(() =>
      expect(useTicketIntentStore.getState().intent).toMatchObject({
        symbol: 'HDFCBANK',
        exchange: 'NSE',
        side: 'SELL',
      }),
    );
  });

  it('reads the Home stock from the URL, drops an unknown one, and switches back', async () => {
    const view = renderApp('/dashboard?stock=RELIANCE', { apiClient: api.apiClient });
    await screen.findByRole('region', { name: 'Trade RELIANCE from the chart' });
    fireEvent.click(screen.getByRole('radio', { name: 'HDFC Bank' }));
    await waitFor(() => expect(view.router.state.location.search).toEqual({ stock: 'HDFCBANK' }));
    expect(
      await screen.findByRole('region', { name: 'Trade HDFCBANK from the chart' }),
    ).toBeInTheDocument();
    view.unmount();

    const unknown = renderApp('/dashboard?stock=FOO', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('region', { name: 'Trade HDFCBANK from the chart' }),
    ).toBeInTheDocument();
    expect(unknown.router.state.location.search).toEqual({});
  });

  it('the route keeps every Home chart symbol in the URL', async () => {
    for (const stock of HOME_CHART_SYMBOLS) {
      const view = renderApp(`/dashboard?stock=${stock}`, { apiClient: api.apiClient });
      expect(
        await screen.findByRole('radio', { name: strings.homeChart.symbolNames[stock] }),
      ).toBeChecked();
      expect(view.router.state.location.search).toEqual({ stock });
      view.unmount();
    }
  });

  it('opens on HDFCBANK to trade from the chart; the picker swaps to Paytm (NSTOCK-0476)', async () => {
    const { router } = renderApp('/dashboard', { apiClient: api.apiClient });
    await screen.findByRole('region', { name: 'Trade HDFCBANK from the chart' });
    fireEvent.click(screen.getByRole('radio', { name: 'Paytm' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ stock: 'PAYTM' }));
    const paytm = await screen.findByRole('region', { name: 'Trade PAYTM from the chart' });
    expect(within(paytm).getByRole('link', { name: 'One97 Communications Ltd' })).toHaveAttribute(
      'href',
      '/stocks/PAYTM',
    );
    expect(within(paytm).getByRole('button', { name: 'Sell PAYTM' })).toBeInTheDocument();
  });

  it('drops an invalid range from the URL and falls back to 1 day', async () => {
    const { router } = renderApp('/dashboard?stock=NIFTY50&range=2Y', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day' }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ stock: 'NIFTY50' });
  });

  it('reads the chart range from the URL and writes it back when a range is picked', async () => {
    const { router } = renderApp('/dashboard?stock=NIFTY50&range=1M', { apiClient: api.apiClient });
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 month' }),
    ).toBeInTheDocument();
    expect(candleRanges()).toContain('1M');
    fireEvent.click(screen.getByRole('radio', { name: '5Y' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ stock: 'NIFTY50', range: '5Y' }),
    );
    await waitFor(() => expect(candleRanges()).toContain('5Y'));
  });

  const candleIntervals = () =>
    api.requestsTo('/NIFTY50/candles').map((url) => url.searchParams.get('interval'));

  it('reads the bar size and chart type from the URL (NSTOCK-0443)', async () => {
    renderApp('/dashboard?stock=NIFTY50&range=1D&interval=5m&chart=candle', {
      apiClient: api.apiClient,
    });
    expect(
      await screen.findByRole('figure', {
        name: 'NIFTY 50 candlestick chart over 1 day, 5-minute bars',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chart type: Candles' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '5-minute bars' })).toBeChecked();
    expect(candleIntervals()).toEqual(['5m']);
    await waitFor(() => expect(chartsMock.active()[0]?.series[0]?.type).toBe('Candlestick'));
  });

  it('writes a picked bar size and chart type back to the URL (NSTOCK-0443)', async () => {
    const { router } = renderApp('/dashboard?stock=NIFTY50', { apiClient: api.apiClient });
    await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day' });
    fireEvent.click(screen.getByRole('radio', { name: '15-minute bars' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ stock: 'NIFTY50', interval: '15m' }),
    );
    await waitFor(() => expect(candleIntervals()).toContain('15m'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chart type: Line' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^OHLC/ }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        stock: 'NIFTY50',
        interval: '15m',
        chart: 'bar',
      }),
    );
    expect(
      await screen.findByRole('figure', {
        name: 'NIFTY 50 OHLC bar chart over 1 day, 15-minute bars',
      }),
    ).toBeInTheDocument();
  });

  it('drops an invalid bar size and chart type (NSTOCK-0443)', async () => {
    const { router } = renderApp('/dashboard?stock=NIFTY50&interval=7m&chart=pie', {
      apiClient: api.apiClient,
    });
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day' }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ stock: 'NIFTY50' });
    expect(candleIntervals()).toEqual(['1m']);
  });

  it('keeps a bar size the next range offers and drops one it does not (NSTOCK-0443)', async () => {
    const { router } = renderApp('/dashboard?stock=NIFTY50&interval=15m', {
      apiClient: api.apiClient,
    });
    await screen.findByRole('figure', { name: /NIFTY 50 line chart over 1 day/ });
    fireEvent.click(screen.getByRole('radio', { name: '1W' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        stock: 'NIFTY50',
        range: '1W',
        interval: '15m',
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '1Y' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ stock: 'NIFTY50', range: '1Y' }),
    );
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

  it('keeps the movers index and direction in the URL', async () => {
    const { router } = renderApp('/dashboard?movers=losers&moversIndex=NIFTYIT', {
      apiClient: api.apiClient,
    });
    const losers = await screen.findByRole('tab', { name: 'Top losers' });
    expect(losers).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'IT' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() =>
      expect(
        api.requestsTo('/market/movers').map((url) => url.searchParams.get('index')),
      ).toContain('NIFTYIT'),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Bank' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ movers: 'losers', moversIndex: 'NIFTYBANK' }),
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Top gainers' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ movers: 'gainers', moversIndex: 'NIFTYBANK' }),
    );
  });
});

describe('dashboard on MSW data (T-100)', () => {
  it('renders every section from the mock API with no errors', async () => {
    renderApp('/dashboard', { apiClient: api.apiClient, marketSession: at(16) });
    // The first chart is a stock to trade on: HDFCBANK unless the URL picks another (NSTOCK-0476).
    const homeChart = await screen.findByRole('region', { name: 'Trade HDFCBANK from the chart' });
    expect(await within(homeChart).findByRole('figure')).toBeInTheDocument();
    expect(within(homeChart).getByRole('button', { name: 'Buy HDFCBANK' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'HDFC Bank' })).toBeChecked();
    const indices = await screen.findByRole('region', { name: 'Market indices' });
    await waitFor(() =>
      expect(within(indices).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5),
    );
    await waitFor(() => expect(linksIn('Stocks lists')).toHaveLength(5));
    await waitFor(() => expect(linksIn('Market movers').length).toBeGreaterThan(0));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Market closed on the fixed clock: no LIVE badge.
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });
});

describe('greeting hero (T-093)', () => {
  it.each([
    [8, 'Good morning'],
    [13, 'Good afternoon'],
    [19, 'Good evening'],
  ])('%i:00 IST greets "%s" and invites a signed-out visitor to start', async (hour, greeting) => {
    renderApp('/dashboard', { apiClient: api.apiClient, marketSession: at(hour) });
    expect(await screen.findByRole('heading', { level: 1, name: greeting })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start paper trading' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('greets a signed-in user by first name and links to funds', async () => {
    signIn(testSession({ name: 'Asha Rao' }));
    renderApp('/dashboard', { apiClient: api.apiClient, marketSession: at(19) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Good evening, Asha' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View funds' })).toHaveAttribute('href', '/funds');
  });

  it('a signed-in user without a name gets the plain greeting', async () => {
    signIn(testSession({ name: null }));
    renderApp('/dashboard', { apiClient: api.apiClient, marketSession: at(8) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Good morning' }),
    ).toBeInTheDocument();
  });
});

describe('section error isolation (T-099)', () => {
  it('a 500 from movers shows ErrorState only in the movers card', async () => {
    api.server.use(
      http.get('*/v1/market/movers', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'movers down' } },
          { status: 500 },
        ),
      ),
    );
    renderApp('/dashboard?stock=NIFTY50', { apiClient: api.apiClient, marketSession: at(16) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Movers unavailable');
    expect(section('Market movers')).toContainElement(alert);
    // Every other section still loads its data.
    await waitFor(() => expect(linksIn('Stocks lists')).toHaveLength(5));
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 line chart over 1 day' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(section('Market indices')).getAllByRole('listitem').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon');
  });

  it('shows a skeleton per section while its data loads', async () => {
    // Hold every market request so the sections stay in their loading state.
    api.server.use(http.get('*/v1/market/*', () => new Promise<never>(() => undefined)));
    renderApp('/dashboard?stock=NIFTY50', { apiClient: api.apiClient, marketSession: at(16) });
    expect(await screen.findByRole('status', { name: 'Loading chart' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /^Loading .*indices/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /^Loading .*Market Giants/ })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /^Loading top gainers/ })).toBeInTheDocument();
  });
});
