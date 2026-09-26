import type { InstrumentStats } from '@nthstock/contracts';
import { formatInr, formatInrCompact } from '@nthstock/utils';
import { act, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_API_ORIGIN } from '@/mocks/node';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { formatCount, formatX100, formatYield } from '../model/statFormat';

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

const statsUrl = `${TEST_API_ORIGIN}/v1/market/instruments/:symbol/stats`;

async function openStats(url: string) {
  const quotes = createTestQuoteStore();
  renderApp(url, { apiClient: api.apiClient, quoteStore: quotes.store });
  const card = await screen.findByRole('region', { name: 'Key stats' });
  return { card, quotes };
}

/** The value shown next to a stat's label. */
const valueOf = (card: HTMLElement, label: string) =>
  within(card).getByText(label, { selector: 'dt' }).nextElementSibling;

describe('key stats (T-109)', () => {
  it('shows every stat from InstrumentStats, with market cap in Cr via formatInrCompact', async () => {
    const stats = (await api.adapter.getStats('TCS')) as InstrumentStats;
    const { card } = await openStats('/stocks/TCS');
    await within(card).findByText('Open', { selector: 'dt' });

    expect(valueOf(card, 'Open')).toHaveTextContent(formatInr(stats.open));
    expect(valueOf(card, 'Prev. close')).toHaveTextContent(formatInr(stats.prevClose));
    expect(valueOf(card, 'Volume')).toHaveTextContent(formatCount(stats.volume));
    const marketCap = formatInrCompact(stats.marketCap ?? 0);
    expect(marketCap).toMatch(/^₹[\d,]+(\.\d{1,2})? Cr$/);
    expect(valueOf(card, 'Market cap')).toHaveTextContent(marketCap);
    expect(valueOf(card, 'P/E ratio')).toHaveTextContent(formatX100(stats.peX100 ?? 0));
    expect(valueOf(card, 'Dividend yield')).toHaveTextContent(
      formatYield(stats.dividendYieldBp ?? 0),
    );
    expect(
      within(card).getByRole('img', {
        name: new RegExp(`^Day range: low ${formatInr(stats.low).replace('.', '\\.')}`),
      }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('img', {
        name: new RegExp(`^52-week range: low ${formatInr(stats.week52Low).replace('.', '\\.')}`),
      }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/^As of .+ IST$/)).toBeInTheDocument();
  });

  it('renders a hand-made InstrumentStats exactly, and dashes for missing values', async () => {
    const stats: InstrumentStats = {
      token: 1,
      symbol: 'INFY',
      exchange: 'NSE',
      open: 150000,
      high: 152000,
      low: 149000,
      prevClose: 149500,
      volume: 12345678,
      week52High: 200000,
      week52Low: 100000,
      upperCircuit: 164450,
      lowerCircuit: 134550,
      marketCap: null,
      peX100: null,
      dividendYieldBp: null,
      asOf: '2026-09-25T10:30:00.000Z',
    };
    api.server.use(http.get(statsUrl, () => HttpResponse.json(stats)));
    const { card, quotes } = await openStats('/stocks/INFY');
    await within(card).findByText('Open', { selector: 'dt' });
    expect(valueOf(card, 'Open')).toHaveTextContent('₹1,500.00');
    expect(valueOf(card, 'Volume')).toHaveTextContent('1,23,45,678');
    expect(valueOf(card, 'Market cap')).toHaveTextContent('Not available');
    expect(valueOf(card, 'P/E ratio')).toHaveTextContent('Not available');
    expect(within(card).getByText('As of 25 Sept 2026, 04:00 pm IST')).toBeInTheDocument();

    // The day-range marker follows the live price; a price above the high stretches the range.
    act(() => quotes.push(testQuote('INFY', 151000)));
    expect(
      within(card).getByRole('img', {
        name: 'Day range: low ₹1,490.00, high ₹1,520.00, last price ₹1,510.00',
      }),
    ).toBeInTheDocument();
    expect(within(card).getAllByTestId('range-marker')[0]).toHaveStyle({ left: '67%' });
    act(() => quotes.push(testQuote('INFY', 153000, { ts: '2026-09-25T04:00:01.000Z' })));
    expect(
      within(card).getByRole('img', {
        name: 'Day range: low ₹1,490.00, high ₹1,530.00, last price ₹1,530.00',
      }),
    ).toBeInTheDocument();
  });

  it('shows an error with a retry when the stats request fails', async () => {
    api.server.use(http.get(statsUrl, () => new HttpResponse(null, { status: 500 })));
    const { card } = await openStats('/stocks/INFY');
    expect(await within(card).findByText('Key stats unavailable')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('is not shown for an index', async () => {
    renderApp('/stocks/NIFTY50', { apiClient: api.apiClient });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Key stats' })).not.toBeInTheDocument();
    expect(api.requestsTo('/stats')).toHaveLength(0);
  });
});
