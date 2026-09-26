import type { MoverDirection } from '@nthstock/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockApi } from '@/test/mockApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MOVERS_ROWS, MarketMoversCard, resolveMoversIndex } from './MarketMoversCard';

const api = createMockApi();
beforeAll(() => api.listen());
afterEach(() => api.reset());
afterAll(() => api.close());

function Harness({ initial = 'gainers' as MoverDirection }) {
  const [index, setIndex] = useState<string | undefined>(undefined);
  const [direction, setDirection] = useState<MoverDirection>(initial);
  return (
    <MarketMoversCard
      index={index}
      direction={direction}
      onIndexChange={setIndex}
      onDirectionChange={setDirection}
    />
  );
}

const moverRequests = () =>
  api
    .requestsTo('/market/movers')
    .map(
      (url) => `${url.searchParams.get('index') ?? ''}:${url.searchParams.get('direction') ?? ''}`,
    );

const rows = () => within(screen.getByRole('tabpanel')).queryAllByRole('link');

describe('MarketMoversCard (T-098)', () => {
  it('shows the Nifty 50 top gainers with ▲ and positive text', async () => {
    renderWithProviders(<Harness />, { apiClient: api.apiClient });
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().length).toBeLessThanOrEqual(MOVERS_ROWS);
    for (const row of rows()) expect(row).toHaveTextContent(/\+₹[\d,]+\.\d{2} \(▲ \d+\.\d{2}%\)/);
    expect(moverRequests()).toEqual(['NIFTY50:gainers']);
    expect(api.requestsTo('/market/movers')[0]?.searchParams.get('limit')).toBe('5');
  });

  it('losers show ▼ with negative text', async () => {
    renderWithProviders(<Harness />, { apiClient: api.apiClient });
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const losers = screen.getByRole('tab', { name: 'Top losers' });
    fireEvent.mouseDown(losers);
    await waitFor(() => expect(losers).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(moverRequests()).toContain('NIFTY50:losers'));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    for (const row of rows()) {
      expect(row).toHaveTextContent(/-₹[\d,]+\.\d{2} \(▼ \d+\.\d{2}%\)/);
      expect(row).toHaveTextContent(/down \d+\.\d{2} percent/);
    }
  });

  it('changing the index refetches for that index', async () => {
    renderWithProviders(<Harness />, { apiClient: api.apiClient });
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('radio', { name: 'Bank' }));
    await waitFor(() => expect(moverRequests()).toEqual(['NIFTY50:gainers', 'NIFTYBANK:gainers']));
    expect(screen.getByRole('radio', { name: 'Bank' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'IT' }));
    await waitFor(() => expect(moverRequests()).toContain('NIFTYIT:gainers'));
  });

  it('resolves unknown index symbols to the Nifty 50', () => {
    expect(resolveMoversIndex('NIFTYBANK').label).toBe('Bank');
    expect(resolveMoversIndex('SENSEX').value).toBe('NIFTY50');
    expect(resolveMoversIndex(undefined).value).toBe('NIFTY50');
  });

  it('says so when nothing moved, and shows an inline error with retry on failure', async () => {
    api.server.use(
      http.get('*/v1/market/movers', ({ request }) => {
        const direction = new URL(request.url).searchParams.get('direction');
        return direction === 'losers'
          ? HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 })
          : HttpResponse.json({
              index: 'NIFTY50',
              direction: 'gainers',
              items: [],
              asOf: '2026-09-25T04:00:00.000Z',
            });
      }),
    );
    renderWithProviders(<Harness />, { apiClient: api.apiClient });
    expect(await screen.findByText('No gainers in NIFTY 50 right now.')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Top losers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Movers unavailable');
    api.server.resetHandlers();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  });
});
