import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession, signOut } from '@/test/session';
import { fakeLayout, loginOnMock, seedList } from '@/test/watchlists';
import { initialWatchlistUiState, useWatchlistUiStore } from '../store/watchlistUiStore';
import { COLLAPSED_KEY, WatchlistSection } from './WatchlistSection';

const { server, adapter } = createMockServer({ clock: fixedClock(fromIst(2026, 9, 25, 16 * 60)) });
let restoreLayout: () => void = () => undefined;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  restoreLayout = fakeLayout(448);
});
afterEach(() => {
  server.resetHandlers();
  resetSession();
  vi.restoreAllMocks();
  window.localStorage.clear();
  useWatchlistUiStore.setState(initialWatchlistUiState());
  useTicketIntentStore.setState(initialTicketIntentState);
});
afterAll(() => {
  server.close();
  adapter.dispose();
  restoreLayout();
});

// Each case logs in and makes several round trips on the MSW node server; CI runners are slow.
const HEAVY = 20_000;

const rowsList = () => screen.getByRole('list', { name: /^Stocks in / });
const rowSymbols = () =>
  within(rowsList())
    .getAllByRole('listitem')
    .map((row) => row.querySelector('a span span')?.textContent);
const rowLink = (symbol: string) =>
  within(rowsList()).getByRole('link', { name: new RegExp(`^${symbol}\\b`) });
const liveRegion = () =>
  screen.getAllByRole('status').find((node) => node.tagName === 'P') as HTMLElement;

async function renderSignedIn(mobile: string, symbols: readonly string[] = []) {
  const apiClient = await loginOnMock(mobile);
  if (symbols.length > 0) await seedList(apiClient, symbols);
  const quotes = createTestQuoteStore();
  const onAddStock = vi.fn();
  const view = renderWithProviders(
    <>
      <label>
        Notes
        <input />
      </label>
      <WatchlistSection onAddStock={onAddStock} />
    </>,
    { apiClient, quoteStore: quotes.store },
  );
  await screen.findByRole('tab', { name: 'My Watchlist' });
  return { ...view, apiClient, quotes, onAddStock };
}

describe('WatchlistSection, logged out', () => {
  it('invites the user to log in and comes back here after', async () => {
    signOut();
    renderWithProviders(<WatchlistSection onAddStock={vi.fn()} />);
    expect(await screen.findByText('Track stocks in watchlists')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Log in to use watchlists' })).toHaveAttribute(
      'href',
      '/login?redirect=%2F',
    );
  });

  it('remembers the collapsed state in localStorage', async () => {
    signOut();
    const { unmount } = renderWithProviders(<WatchlistSection onAddStock={vi.fn()} />);
    const toggle = await screen.findByRole('button', { name: /Watchlists/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('1');
    unmount();

    renderWithProviders(<WatchlistSection onAddStock={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /Watchlists/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Track stocks in watchlists')).not.toBeVisible();
  });

  it('still renders and toggles when storage throws', async () => {
    signOut();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    renderWithProviders(<WatchlistSection onAddStock={vi.fn()} />);
    const toggle = await screen.findByRole('button', { name: /Watchlists/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('WatchlistSection, logged in (T-119)', () => {
  it(
    'shows a new user the empty state with Add stock',
    async () => {
      const { onAddStock } = await renderSignedIn('9812200001');
      expect(await screen.findByText('This watchlist is empty')).toBeVisible();
      expect(screen.getByRole('tab', { name: 'My Watchlist' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add stock' }));
      expect(onAddStock).toHaveBeenCalledOnce();
    },
    HEAVY,
  );

  it(
    'shows a seeded list with symbol, exchange, price and change, ticking live',
    async () => {
      const { quotes } = await renderSignedIn('9812200002', ['INFY', 'TCS']);
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY', 'TCS']));
      expect(screen.getByText('2 stocks')).toBeInTheDocument();
      expect(quotes.subscribed.get('NSE:INFY')).toBe(1);

      act(() => {
        quotes.push(testQuote('INFY', 184_235, { prevClose: 180_000 }));
      });
      const infy = rowLink('INFY');
      expect(infy).toHaveTextContent('NSE');
      expect(infy).toHaveTextContent('₹1,842.35');
      expect(infy).toHaveTextContent('▲');
      act(() => {
        quotes.push(testQuote('INFY', 179_000, { prevClose: 180_000, ts: '2026-09-25T04:00:01Z' }));
      });
      expect(infy).toHaveTextContent('₹1,790.00');
      expect(infy).toHaveTextContent('▼');
    },
    HEAVY,
  );
});

describe('row keys (T-122, T-125, T-121)', () => {
  it(
    'Alt+↓ moves the focused row, announces it, and the order persists',
    async () => {
      const { apiClient, queryClient } = await renderSignedIn('9812200003', [
        'INFY',
        'TCS',
        'SBIN',
      ]);
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY', 'TCS', 'SBIN']));
      const infy = rowLink('INFY');
      infy.focus();
      fireEvent.keyDown(infy, { key: 'ArrowDown', altKey: true });

      await waitFor(() => expect(rowSymbols()).toEqual(['TCS', 'INFY', 'SBIN']));
      expect(liveRegion()).toHaveTextContent('INFY moved to position 2 of 3');
      await waitFor(() => expect(rowLink('INFY')).toHaveFocus());
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));

      // What a reload would load.
      const { items } = await apiClient.request('watchlistsList');
      expect(items[0]?.items.map((i) => i.symbol)).toEqual(['TCS', 'INFY', 'SBIN']);

      fireEvent.keyDown(rowLink('INFY'), { key: 'ArrowUp', altKey: true });
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY', 'TCS', 'SBIN']));
    },
    HEAVY,
  );

  it(
    '↑/↓ move focus between rows with one tab stop',
    async () => {
      await renderSignedIn('9812200004', ['INFY', 'TCS']);
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY', 'TCS']));
      expect(rowLink('INFY')).toHaveAttribute('tabindex', '0');
      expect(rowLink('TCS')).toHaveAttribute('tabindex', '-1');
      rowLink('INFY').focus();
      fireEvent.keyDown(rowLink('INFY'), { key: 'ArrowDown' });
      await waitFor(() => expect(rowLink('TCS')).toHaveFocus());
      expect(rowLink('TCS')).toHaveAttribute('tabindex', '0');
      fireEvent.keyDown(rowLink('TCS'), { key: 'Home' });
      await waitFor(() => expect(rowLink('INFY')).toHaveFocus());
    },
    HEAVY,
  );

  it(
    'B on a focused INFY row sets the ticket intent to INFY BUY; B in an input does nothing',
    async () => {
      await renderSignedIn('9812200005', ['INFY']);
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY']));

      const input = screen.getByRole('textbox', { name: 'Notes' });
      input.focus();
      fireEvent.keyDown(input, { key: 'b' });
      fireEvent.keyDown(input, { key: 'B' });
      expect(useTicketIntentStore.getState().intent).toBeNull();

      rowLink('INFY').focus();
      fireEvent.keyDown(rowLink('INFY'), { key: 'b' });
      expect(useTicketIntentStore.getState().intent).toEqual({
        symbol: 'INFY',
        exchange: 'NSE',
        side: 'BUY',
      });
      expect(await screen.findByText('Buy INFY')).toBeInTheDocument();

      fireEvent.keyDown(rowLink('INFY'), { key: 'S' });
      expect(useTicketIntentStore.getState().intent?.side).toBe('SELL');
    },
    HEAVY,
  );

  it(
    'the hover B and S buttons dispatch the intent too',
    async () => {
      await renderSignedIn('9812200006', ['TCS']);
      await waitFor(() => expect(rowSymbols()).toEqual(['TCS']));
      fireEvent.click(screen.getByRole('button', { name: 'Sell TCS' }));
      expect(useTicketIntentStore.getState().intent).toEqual({
        symbol: 'TCS',
        exchange: 'NSE',
        side: 'SELL',
      });
    },
    HEAVY,
  );

  it(
    'Delete and the remove button take stocks out of the list',
    async () => {
      const { apiClient, queryClient } = await renderSignedIn('9812200007', [
        'INFY',
        'TCS',
        'SBIN',
      ]);
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY', 'TCS', 'SBIN']));
      rowLink('INFY').focus();
      fireEvent.keyDown(rowLink('INFY'), { key: 'Delete' });
      await waitFor(() => expect(rowSymbols()).toEqual(['TCS', 'SBIN']));
      expect(liveRegion()).toHaveTextContent('INFY removed from My Watchlist');
      await waitFor(() => expect(rowLink('TCS')).toHaveFocus());

      fireEvent.click(screen.getByRole('button', { name: 'Remove SBIN' }));
      await waitFor(() => expect(rowSymbols()).toEqual(['TCS']));
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      const { items } = await apiClient.request('watchlistsList');
      expect(items[0]?.items.map((i) => i.symbol)).toEqual(['TCS']);
    },
    HEAVY,
  );
});

describe('sort (T-123)', () => {
  it(
    '% change high to low sorts by the day change, custom restores the saved order',
    async () => {
      const { quotes } = await renderSignedIn('9812200008', ['INFY', 'TCS', 'SBIN']);
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY', 'TCS', 'SBIN']));
      act(() => {
        quotes.push(
          testQuote('INFY', 100_000, { prevClose: 101_000, ts: '2026-09-25T05:00:00Z' }),
          testQuote('TCS', 100_000, { prevClose: 95_000, ts: '2026-09-25T05:00:00Z' }),
          testQuote('SBIN', 100_000, { prevClose: 99_000, ts: '2026-09-25T05:00:00Z' }),
        );
      });

      act(() => useWatchlistUiStore.getState().setSort('change'));
      await waitFor(() => expect(rowSymbols()).toEqual(['TCS', 'SBIN', 'INFY']));
      // Sorted views have no drag handle, and Alt+↑/↓ explains why nothing moved.
      expect(document.querySelector('[data-drag-handle]')).toBeNull();
      fireEvent.keyDown(rowLink('TCS'), { key: 'ArrowDown', altKey: true });
      expect(liveRegion()).toHaveTextContent('Choose Custom order in Sort to reorder stocks');

      act(() => useWatchlistUiStore.getState().setSort('custom'));
      await waitFor(() => expect(rowSymbols()).toEqual(['INFY', 'TCS', 'SBIN']));
      expect(document.querySelector('[data-drag-handle="INFY"]')).not.toBeNull();
    },
    HEAVY,
  );
});

describe('list dialogs and tabs (T-120, T-122)', () => {
  it(
    'creates a list; a duplicate name shows an error',
    async () => {
      await renderSignedIn('9812200009');
      fireEvent.click(screen.getByRole('button', { name: 'New watchlist' }));
      const dialog = await screen.findByRole('dialog', { name: 'New watchlist' });
      const name = within(dialog).getByRole('textbox', { name: 'Name' });
      await waitFor(() => expect(name).toHaveFocus());

      fireEvent.change(name, { target: { value: ' my watchlist ' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'You already have a watchlist with this name',
      );
      expect(name).toHaveAttribute('aria-invalid', 'true');

      fireEvent.change(name, { target: { value: 'x'.repeat(25) } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      await waitFor(() =>
        expect(within(dialog).getByRole('alert')).toHaveTextContent('24 characters or fewer'),
      );

      fireEvent.change(name, { target: { value: 'Banks' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const banks = await screen.findByRole('tab', { name: 'Banks' });
      await waitFor(() => expect(banks).toHaveAttribute('aria-selected', 'true'));
      expect(liveRegion()).toHaveTextContent('Watchlist Banks created');
    },
    HEAVY,
  );

  it(
    'renames the open list, and delete asks for confirmation first',
    async () => {
      const { apiClient, queryClient } = await renderSignedIn('9812200010');
      await apiClient.request('watchlistCreate', { body: { name: 'Banks' } });
      await act(() => queryClient.invalidateQueries());
      fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Banks' }), { button: 0 });
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: 'Banks' })).toHaveAttribute('aria-selected', 'true'),
      );

      const openActions = async (item: string) => {
        const trigger = screen.getByRole('button', { name: /^Actions for / });
        fireEvent.keyDown(trigger, { key: 'Enter' });
        fireEvent.click(await screen.findByRole('menuitem', { name: item }));
      };

      await openActions('Rename');
      const renameDialog = await screen.findByRole('dialog', { name: 'Rename watchlist' });
      const name = within(renameDialog).getByRole('textbox', { name: 'Name' });
      expect(name).toHaveValue('Banks');
      fireEvent.change(name, { target: { value: 'PSU banks' } });
      fireEvent.click(within(renameDialog).getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('tab', { name: 'PSU banks' })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await openActions('Delete');
      const confirm = await screen.findByRole('dialog', { name: 'Delete “PSU banks”?' });
      expect(confirm).toHaveTextContent('This cannot be undone');
      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('tab', { name: 'PSU banks' })).toBeInTheDocument();

      await openActions('Delete');
      const again = await screen.findByRole('dialog', { name: 'Delete “PSU banks”?' });
      fireEvent.click(within(again).getByRole('button', { name: 'Delete watchlist' }));
      await waitFor(() => expect(screen.queryByRole('tab', { name: 'PSU banks' })).toBeNull());
      expect(screen.getByRole('tab', { name: 'My Watchlist' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      const { items } = await apiClient.request('watchlistsList');
      expect(items.map((list) => list.name)).toEqual(['My Watchlist']);
    },
    HEAVY,
  );

  it(
    'the last list cannot be deleted',
    async () => {
      await renderSignedIn('9812200011');
      fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for My Watchlist' }), {
        key: 'Enter',
      });
      expect(
        await screen.findByRole('menuitem', { name: 'You need at least one watchlist' }),
      ).toHaveAttribute('aria-disabled', 'true');
    },
    HEAVY,
  );

  it(
    'Alt+→ moves a list tab and keeps focus on it',
    async () => {
      const { apiClient, queryClient } = await renderSignedIn('9812200012');
      await apiClient.request('watchlistCreate', { body: { name: 'Banks' } });
      await act(() => queryClient.invalidateQueries());
      await screen.findByRole('tab', { name: 'Banks' });
      const tabs = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
      expect(tabs()).toEqual(['My Watchlist', 'Banks']);

      const first = screen.getByRole('tab', { name: 'My Watchlist' });
      first.focus();
      fireEvent.keyDown(first, { key: 'ArrowRight', altKey: true });
      await waitFor(() => expect(tabs()).toEqual(['Banks', 'My Watchlist']));
      expect(liveRegion()).toHaveTextContent('My Watchlist moved to position 2 of 2');
      await waitFor(() => expect(screen.getByRole('tab', { name: 'My Watchlist' })).toHaveFocus());
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      const { items } = await apiClient.request('watchlistsList');
      expect(items.map((list) => list.name)).toEqual(['Banks', 'My Watchlist']);
    },
    HEAVY,
  );
});
