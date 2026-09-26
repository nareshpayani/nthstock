import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { LIST_ROWS, StocksListsCard, resolveListId } from './StocksListsCard';

const api = createMockApi();
beforeAll(() => api.listen());
afterEach(() => api.reset());
afterAll(() => api.close());

function Harness({ initial }: { initial?: string }) {
  const [listId, setListId] = useState(initial);
  return <StocksListsCard listId={listId} onListChange={setListId} />;
}

function renderCard(initial?: string) {
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(<Harness {...(initial ? { initial } : {})} />, {
    apiClient: api.apiClient,
    quoteStore: quotes.store,
  });
  return { ...view, quotes };
}

const listRequests = () =>
  api.requests.filter((url) => url.pathname.startsWith('/v1/market/lists/')).map((u) => u.pathname);

const rows = () => within(screen.getByRole('tabpanel')).getAllByRole('link');

describe('StocksListsCard (T-097)', () => {
  it('shows a tab per curated list and the first list’s rows', async () => {
    renderCard();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Market Giants',
      'Best Returns',
      'Highest Dividends',
      'Top IT',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(rows()).toHaveLength(LIST_ROWS));
    expect(rows()[0]).toHaveTextContent(/₹[\d,]+\.\d{2}/);
    expect(rows()[0]).toHaveTextContent(/[▲▼●] \d+\.\d{2}%/);
    expect(listRequests()).toEqual(['/v1/market/lists/market-giants']);
  });

  it('switching tabs fetches that list', async () => {
    renderCard();
    await waitFor(() => expect(rows()).toHaveLength(LIST_ROWS));
    const tab = screen.getByRole('tab', { name: 'Top IT' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(listRequests()).toContain('/v1/market/lists/top-it'));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  });

  it('opens the list from its id and falls back to the first list for an unknown id', () => {
    expect(resolveListId('best-returns')).toBe('best-returns');
    expect(resolveListId('nope')).toBe('market-giants');
    expect(resolveListId(undefined)).toBe('market-giants');
  });

  it('rows tick live and clicking one navigates to /stocks/<symbol>', async () => {
    const { quotes, router } = renderCard('best-returns');
    await waitFor(() => expect(rows()).toHaveLength(LIST_ROWS));
    const first = rows()[0] as HTMLElement;
    const symbol = /([A-Z0-9&-]+) · NSE/.exec(first.textContent ?? '')?.[1] ?? '';
    expect(symbol).not.toBe('');
    expect(first).toHaveAttribute('href', `/stocks/${encodeURIComponent(symbol)}`);
    act(() => quotes.push(testQuote(symbol, 123456, { prevClose: 120000 })));
    expect(first).toHaveTextContent('₹1,234.56▲');
    expect(first).toHaveTextContent('+₹34.56 (▲ 2.88%)');
    fireEvent.click(first);
    await screen.findByRole('heading', { name: `Stock ${symbol}` });
    expect(router.state.location.pathname).toBe(`/stocks/${encodeURIComponent(symbol)}`);
  });

  it('shows an inline error with a retry when a list fails', async () => {
    api.server.use(
      http.get('*/v1/market/lists/:id', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
    );
    renderCard();
    expect(await screen.findByRole('alert')).toHaveTextContent('List unavailable');
    api.server.resetHandlers();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rows()).toHaveLength(LIST_ROWS));
  });

  it('says so when a list is empty', async () => {
    api.server.use(
      http.get('*/v1/market/lists/:id', () =>
        HttpResponse.json({
          id: 'market-giants',
          title: 'Market Giants',
          description: null,
          items: [],
        }),
      ),
    );
    renderCard();
    expect(await screen.findByText('No stocks in this list right now.')).toBeInTheDocument();
  });
});
