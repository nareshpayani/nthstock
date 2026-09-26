import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '@/test/mockApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RECENT_SEARCHES_KEY, readRecentSearches } from '../model/recentSearches';
import { SearchBox } from './SearchBox';

const api = createMockApi();
beforeAll(() => api.listen());
afterEach(() => {
  api.reset();
  window.localStorage.clear();
});
afterAll(() => api.close());

async function renderSearch(props: { onNavigate?: () => void } = {}) {
  const view = renderWithProviders(
    <div>
      <button type="button">Before</button>
      <SearchBox {...props} />
    </div>,
    { apiClient: api.apiClient },
  );
  await screen.findByRole('combobox', { name: 'Search stocks' });
  return { ...view, input: () => screen.getByRole('combobox', { name: 'Search stocks' }) };
}

const listbox = () => screen.getByRole('listbox', { name: 'Stock suggestions', hidden: true });
const options = () => within(listbox()).queryAllByRole('option');

async function typeAndWait(input: HTMLElement, text: string) {
  input.focus();
  fireEvent.change(input, { target: { value: text } });
  await waitFor(() => expect(options().length).toBeGreaterThan(0));
}

describe('SearchBox results (T-103)', () => {
  it('is a combobox that shows symbol, name and exchange with the matches marked', async () => {
    const { input } = await renderSearch();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveAttribute('aria-autocomplete', 'list');
    await typeAndWait(input(), 'inf');

    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(input()).toHaveAttribute('aria-controls', listbox().id);
    const first = options()[0] as HTMLElement;
    expect(first).toHaveTextContent('INFY');
    expect(first).toHaveTextContent('Infosys Ltd');
    expect(first).toHaveTextContent('NSE');
    expect([...first.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['INF', 'Inf']);
    expect(screen.getByRole('status')).toHaveTextContent(/^\d+ results?$/);
  });

  it('debounces typing into one request for what was typed last', async () => {
    const { input } = await renderSearch();
    input().focus();
    for (const value of ['t', 'ta', 'tat', 'tata']) {
      fireEvent.change(input(), { target: { value } });
    }
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    const searches = api.requestsTo('/market/search');
    expect(searches.map((url) => url.searchParams.get('q'))).toEqual(['tata']);
    expect(searches[0]?.searchParams.get('limit')).toBe('8');
  });

  it('says so when nothing matches', async () => {
    const { input } = await renderSearch();
    input().focus();
    fireEvent.change(input(), { target: { value: 'zzqqxx' } });
    expect(await screen.findByText('No stocks match “zzqqxx”')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('0 results');
    expect(input()).not.toHaveAttribute('aria-activedescendant');
  });

  it('shows an error when search fails', async () => {
    api.server.use(
      http.get('*/v1/market/search', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
    );
    const { input } = await renderSearch();
    input().focus();
    fireEvent.change(input(), { target: { value: 'infy' } });
    const message = 'Search is unavailable right now. Try again in a moment.';
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
    expect(screen.getByText(message, { selector: 'p:not([role])' })).toBeVisible();
    expect(input()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('SearchBox keyboard, recent and popular (T-104)', () => {
  it('an empty box shows recent searches, then popular ones', async () => {
    window.localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([
        {
          token: 1,
          symbol: 'TCS',
          exchange: 'NSE',
          name: 'Tata Consultancy Services Ltd',
          type: 'EQUITY',
        },
      ]),
    );
    const popular = await api.adapter.getPopularSearches();
    const { input } = await renderSearch();
    act(() => input().focus());

    const recentGroup = await screen.findByRole('group', { name: 'Recent searches' });
    const popularGroup = await screen.findByRole('group', { name: 'Popular searches' });
    expect(recentGroup.compareDocumentPosition(popularGroup)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      within(recentGroup)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['TCSTata Consultancy Services LtdNSE']);
    const popularSymbols = within(popularGroup)
      .getAllByRole('option')
      .map((o) => o.firstElementChild?.firstElementChild?.textContent);
    expect(popularSymbols).toEqual(
      popular.map((hit) => hit.symbol).filter((symbol) => symbol !== 'TCS'),
    );
    expect(listbox().querySelector('mark')).toBeNull();
  });

  it('↑/↓ move the active option, wrapping, and Enter opens /stocks/<symbol>', async () => {
    const onNavigate = vi.fn();
    const { input, router } = await renderSearch({ onNavigate });
    await typeAndWait(input(), 'tata');
    const count = options().length;
    expect(count).toBeGreaterThan(2);

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', options()[0]?.id);
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', options()[1]?.id);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveAttribute('aria-activedescendant', options()[count - 1]?.id);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });

    const chosen = options()[1]?.firstElementChild?.firstElementChild?.textContent ?? '';
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/stocks/${chosen}`));
    expect(await screen.findByRole('heading', { name: `Stock ${chosen}` })).toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(readRecentSearches()[0]?.symbol).toBe(chosen);
  });

  it('Enter with nothing highlighted opens the first match for what is typed', async () => {
    const { input, router } = await renderSearch();
    input().focus();
    fireEvent.change(input(), { target: { value: 'infy' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/INFY'));
  });

  it('a click on an option opens that stock', async () => {
    const { input, router } = await renderSearch();
    await typeAndWait(input(), 'infy');
    fireEvent.click(options()[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/INFY'));
  });

  it('Esc closes the list and returns focus to where it was', async () => {
    const { input } = await renderSearch();
    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    act(() => input().focus());
    fireEvent.change(input(), { target: { value: 'infy' } });
    await waitFor(() => expect(options().length).toBeGreaterThan(0));

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(before).toHaveFocus();
    expect(input()).toHaveValue('infy');
  });

  it('Esc from a box focused from the page blurs it', async () => {
    const { input } = await renderSearch();
    await typeAndWait(input(), 'infy');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).not.toHaveFocus();
  });

  it('inside a dialog Esc keeps focus in the box, and ↓ reopens the list', async () => {
    renderWithProviders(
      <div role="dialog" aria-label="Menu">
        <SearchBox />
      </div>,
      { apiClient: api.apiClient },
    );
    const input = await screen.findByRole('combobox', { name: 'Search stocks' });
    await typeAndWait(input, 'infy');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });
});
