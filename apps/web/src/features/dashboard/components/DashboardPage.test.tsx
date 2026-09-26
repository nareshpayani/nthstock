import { fixedClock, fromIst } from '@nthstock/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession, signIn, testSession } from '@/test/session';

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
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 area chart over 1 year' }),
    ).toBeInTheDocument();
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
    renderApp('/dashboard', { apiClient: api.apiClient, marketSession: at(16) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Movers unavailable');
    expect(section('Market movers')).toContainElement(alert);
    // Every other section still loads its data.
    await waitFor(() => expect(linksIn('Stocks lists')).toHaveLength(5));
    expect(
      await screen.findByRole('figure', { name: 'NIFTY 50 area chart over 1 year' }),
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
    renderApp('/dashboard', { apiClient: api.apiClient, marketSession: at(16) });
    expect(await screen.findByRole('status', { name: 'Loading chart' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /^Loading .*indices/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /^Loading .*Market Giants/ })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /^Loading top gainers/ })).toBeInTheDocument();
  });
});
