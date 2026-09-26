import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '@/test/mockApi';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { IndicesRow, scrollRowByKey } from './IndicesRow';

const api = createMockApi();
beforeAll(() => api.listen());
afterEach(() => api.reset());
afterAll(() => api.close());

function renderRow() {
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(<IndicesRow />, {
    apiClient: api.apiClient,
    quoteStore: quotes.store,
  });
  return { ...view, quotes };
}

const cardFor = (name: string) =>
  screen
    .getAllByRole('listitem')
    .find((item) => item.firstElementChild?.textContent === name) as HTMLElement;

describe('IndicesRow (T-096)', () => {
  it('renders at least 5 index cards from the API with ▲▼ changes and sparklines', async () => {
    renderRow();
    expect(
      await screen.findByRole('status', { name: 'Loading market indices' }),
    ).toBeInTheDocument();
    const region = await screen.findByRole('region', { name: 'Market indices' });
    const cards = within(region).getAllByRole('listitem');
    expect(cards.length).toBeGreaterThanOrEqual(5);
    for (const card of cards) {
      expect(card).toHaveTextContent(/[\d,]+\.\d{2}/);
      expect(card).toHaveTextContent(/[▲▼●] \d+\.\d{2}%/);
      expect(within(card).getByRole('img', { name: /intraday trend$/ })).toBeInTheDocument();
    }
    expect(api.requestsTo('/market/indices')).toHaveLength(1);
  });

  it('ticks the level and change live from the quote store', async () => {
    const { quotes } = renderRow();
    await screen.findByRole('region', { name: 'Market indices' });
    act(() => quotes.push(testQuote('NIFTY50', 2541860, { prevClose: 2520615 })));
    const nifty = cardFor('NIFTY 50');
    expect(nifty).toHaveTextContent('25,418.60');
    expect(nifty).toHaveTextContent('▲ 0.84%');
    act(() => quotes.push(testQuote('NIFTY50', 2500000, { prevClose: 2520615 })));
    expect(nifty).toHaveTextContent('25,000.00▼');
    expect(within(nifty).getByText('down 0.82 percent')).toBeInTheDocument();
    act(() => quotes.push(testQuote('SENSEX', 8309215, { exchange: 'BSE', prevClose: 8319185 })));
    expect(cardFor('SENSEX')).toHaveTextContent('83,092.15');
  });

  it('is a focusable, snapping region that the arrow keys, Home and End scroll', async () => {
    renderRow();
    const region = await screen.findByRole('region', { name: 'Market indices' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('snap-x', 'snap-mandatory');
    const scrollBy = vi.fn();
    const scrollTo = vi.fn();
    Object.assign(region, { scrollBy, scrollTo });
    vi.spyOn(region.querySelector('li') as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      width: 200,
    } as DOMRect);
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 200 });
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -200 });
    fireEvent.keyDown(region, { key: 'End' });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: region.scrollWidth });
    fireEvent.keyDown(region, { key: 'Home' });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0 });
    fireEvent.keyDown(region, { key: 'a' });
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it('ignores keys pressed inside a card and steps by the row width without cards', () => {
    const row = document.createElement('div');
    const scrollBy = vi.fn();
    Object.assign(row, { scrollBy });
    Object.defineProperty(row, 'clientWidth', { value: 300 });
    expect(scrollRowByKey(row, 'ArrowRight')).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ left: 300 });
    expect(scrollRowByKey(row, 'Tab')).toBe(false);
  });

  it('shows an inline error with a retry', async () => {
    api.server.use(
      http.get('*/v1/market/indices', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
    );
    renderRow();
    expect(await screen.findByRole('alert')).toHaveTextContent('Indices unavailable');
    api.server.resetHandlers();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Market indices' })).toBeInTheDocument(),
    );
  });
});
