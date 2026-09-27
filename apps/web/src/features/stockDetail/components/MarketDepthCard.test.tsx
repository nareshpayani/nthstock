import type { Depth } from '@nthstock/contracts';
import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import { act, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_API_ORIGIN } from '@/mocks/node';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import { chartsMock } from '@/test/chartsMock';
import { installIntersectionObserver, setPageVisibility } from '@/test/intersectionObserver';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore } from '@/test/quotes';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { DEPTH_REFRESH_MS } from '../api/stockDetailQueries';
import { barPercent, depthScale } from '../model/depthBars';
import { formatCount } from '../model/statFormat';

vi.mock('lightweight-charts', () => import('@/test/chartsMock'));

const api = createMockApi();
beforeAll(() => api.listen());
afterEach(() => api.reset());
afterAll(() => api.close());

let io: ReturnType<typeof installIntersectionObserver>;
beforeEach(() => {
  installResizeObserver();
  io = installIntersectionObserver();
  chartsMock.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setPageVisibility('visible');
  resetSession();
});

const depthUrl = `${TEST_API_ORIGIN}/v1/market/instruments/:symbol/depth`;
/** Friday 25 Sep 2026, 10:30 IST: NSE open. */
const OPEN: MarketSession = {
  clock: fixedClock(fromIst(2026, 9, 25, 10 * 60 + 30)),
  alwaysOpen: false,
};
/** Friday 25 Sep 2026, 16:00 IST: NSE closed. */
const CLOSED: MarketSession = {
  clock: fixedClock(fromIst(2026, 9, 25, 16 * 60)),
  alwaysOpen: false,
};

const level = (price: number, qty: number, orders = 3) => ({ price, qty, orders });
const handMade: Depth = {
  token: 1,
  symbol: 'INFY',
  exchange: 'NSE',
  bids: [
    level(152_340, 120),
    level(152_335, 60),
    level(152_330, 30),
    level(152_325, 12),
    level(152_320, 1),
  ],
  asks: [
    level(152_345, 240, 12),
    level(152_350, 180),
    level(152_355, 90),
    level(152_360, 24),
    level(152_365, 6),
  ],
  totalBidQty: 1_48_900,
  totalAskQty: 3_71_000,
  ts: '2026-09-25T05:00:00.000Z',
};

async function openDepth(url: string, marketSession: MarketSession = CLOSED) {
  const quotes = createTestQuoteStore();
  renderApp(url, { apiClient: api.apiClient, quoteStore: quotes.store, marketSession });
  const card = await screen.findByRole('region', { name: 'Market depth' });
  await within(card).findByRole('table', { name: 'Bids (buy orders)' });
  return card;
}

const widths = (table: HTMLElement) =>
  within(table)
    .getAllByTestId('depth-bar')
    .map((bar) => bar.style.width);

/** Advances the faked setInterval clock (refetchInterval) and lets fetches settle. */
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('market depth (T-110)', () => {
  it('shows five levels a side from the adapter, with totals and bars scaled to quantity', async () => {
    const depth = (await api.adapter.getDepth('INFY')) as Depth;
    const card = await openDepth('/stocks/INFY');
    const bids = within(card).getByRole('table', { name: 'Bids (buy orders)' });
    const asks = within(card).getByRole('table', { name: 'Offers (sell orders)' });

    const bidRows = within(bids).getAllByTestId('depth-bid-row');
    expect(bidRows).toHaveLength(5);
    expect(within(asks).getAllByTestId('depth-ask-row')).toHaveLength(5);
    expect(bidRows[0]).toHaveTextContent(formatInr(depth.bids[0]?.price ?? 0));
    expect(bidRows[0]).toHaveTextContent(formatCount(depth.bids[0]?.qty ?? 0));

    const max = depthScale(depth);
    expect(widths(bids)).toEqual(depth.bids.map((l) => `${String(barPercent(l.qty, max))}%`));
    expect(widths(asks)).toEqual(depth.asks.map((l) => `${String(barPercent(l.qty, max))}%`));
    expect(
      within(bids).getByRole('rowheader', { name: 'Total bid qty' }).nextElementSibling,
    ).toHaveTextContent(formatCount(depth.totalBidQty));
    expect(within(card).getByText('Market closed')).toBeInTheDocument();
    expect(within(card).getByText(/^As of .+ IST$/)).toBeInTheDocument();
  });

  it('scales bars against the largest quantity on either side', async () => {
    api.server.use(http.get(depthUrl, () => HttpResponse.json(handMade)));
    const card = await openDepth('/stocks/INFY');
    const bids = within(card).getByRole('table', { name: 'Bids (buy orders)' });
    const asks = within(card).getByRole('table', { name: 'Offers (sell orders)' });

    // The largest level is the best offer (240), so it is the only full-width bar.
    expect(widths(asks)).toEqual(['100%', '75%', '38%', '10%', '3%']);
    expect(widths(bids)).toEqual(['50%', '25%', '13%', '5%', '2%']);
    expect(within(bids).getAllByTestId('depth-bid-row')[0]).toHaveTextContent('₹1,523.40');
    expect(within(asks).getAllByTestId('depth-ask-row')[0]).toHaveTextContent(/₹1,523\.4512240/);
    expect(within(card).getByText('1,48,900')).toBeInTheDocument();
    expect(within(card).getByText('3,71,000')).toBeInTheDocument();
  });

  it('refreshes every second while open, visible and on screen, and stops when the tab is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const card = await openDepth('/stocks/INFY', OPEN);
    const fetches = () => api.requestsTo('/depth').length;
    const first = fetches();
    expect(first).toBe(1);
    expect(within(card).getByText('Top 5 levels, updated every second')).toBeInTheDocument();

    await advance(DEPTH_REFRESH_MS);
    await vi.waitFor(() => expect(fetches()).toBe(2));
    await advance(DEPTH_REFRESH_MS);
    await vi.waitFor(() => expect(fetches()).toBe(3));

    act(() => setPageVisibility('hidden'));
    await advance(DEPTH_REFRESH_MS * 5);
    expect(fetches()).toBe(3);
    expect(within(card).getByText('Top 5 levels, updates paused while hidden')).toBeInTheDocument();

    act(() => setPageVisibility('visible'));
    await advance(DEPTH_REFRESH_MS);
    await vi.waitFor(() => expect(fetches()).toBeGreaterThan(3));
  });

  it('stops refreshing when the card scrolls out of view', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const card = await openDepth('/stocks/INFY', OPEN);
    expect(io.observed()).toContain(card.parentElement);
    const fetches = () => api.requestsTo('/depth').length;

    act(() => io.setInView(false));
    await advance(DEPTH_REFRESH_MS * 5);
    expect(fetches()).toBe(1);

    act(() => io.setInView(true));
    await advance(DEPTH_REFRESH_MS);
    await vi.waitFor(() => expect(fetches()).toBe(2));
  });

  it('does not poll while the market is closed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await openDepth('/stocks/INFY', CLOSED);
    await advance(DEPTH_REFRESH_MS * 5);
    expect(api.requestsTo('/depth')).toHaveLength(1);
  });

  it('keeps the same table shape while loading, so nothing shifts when data arrives', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.server.use(
      http.get(depthUrl, async () => {
        await gate;
        return HttpResponse.json(handMade);
      }),
    );
    renderApp('/stocks/INFY', {
      apiClient: api.apiClient,
      quoteStore: createTestQuoteStore().store,
      marketSession: CLOSED,
    });
    const loading = await screen.findByRole('status', { name: 'Loading market depth' });
    expect(within(loading).getAllByTestId('depth-bid-row')).toHaveLength(5);
    expect(within(loading).getAllByTestId('depth-ask-row')).toHaveLength(5);
    release();
    const card = screen.getByRole('region', { name: 'Market depth' });
    await within(card).findByText('₹1,523.40');
    expect(within(card).getAllByTestId('depth-bid-row')).toHaveLength(5);
  });

  it('shows an error with a retry when depth fails', async () => {
    api.server.use(http.get(depthUrl, () => new HttpResponse(null, { status: 500 })));
    renderApp('/stocks/INFY', { apiClient: api.apiClient, marketSession: CLOSED });
    const card = await screen.findByRole('region', { name: 'Market depth' });
    expect(await within(card).findByText('Market depth unavailable')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('is not shown for an index', async () => {
    renderApp('/stocks/NIFTY50', { apiClient: api.apiClient });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Market depth' })).not.toBeInTheDocument();
    expect(api.requestsTo('/depth')).toHaveLength(0);
  });
});
