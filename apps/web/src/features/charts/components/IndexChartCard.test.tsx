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

  it('shows the LIVE badge while NSE is open', async () => {
    renderCard(tradingClock);
    const heading = await screen.findByRole('heading', { name: /NIFTY 50/ });
    expect(heading).toHaveTextContent(/Live/);
  });

  it('hides the LIVE badge on a holiday clock', async () => {
    renderCard(holidayClock);
    const heading = await screen.findByRole('heading', { name: /NIFTY 50/ });
    expect(heading).not.toHaveTextContent(/Live/);
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
});
