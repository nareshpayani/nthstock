import type { WatchlistItem } from '@nthstock/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { fakeLayout } from '@/test/watchlists';
import { ROW_HEIGHT } from './WatchlistRow';
import { VISIBLE_ROWS, WatchlistRows } from './WatchlistRows';

const items: WatchlistItem[] = ['INFY', 'TCS', 'ITC'].map((symbol, index) => ({
  token: 6000 + index,
  symbol,
  exchange: 'NSE',
  name: symbol,
  addedAt: '2026-09-25T04:00:00.000Z',
}));

/** A touch screen: only the coarse-pointer query matches. */
function touchScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = fakeLayout(VISIBLE_ROWS * ROW_HEIGHT);
});
afterAll(() => restoreLayout());
afterEach(() => vi.unstubAllGlobals());

function renderRows({ reorderable = true } = {}) {
  const handlers = { onReorder: vi.fn(), onTrade: vi.fn(), onRemove: vi.fn() };
  renderWithProviders(
    <WatchlistRows
      label="Stocks in My list"
      items={items}
      snapshot={new Map()}
      reorderable={reorderable}
      onReorderBlocked={vi.fn()}
      {...handlers}
    />,
  );
  return handlers;
}

async function openActions(symbol: string) {
  const trigger = await screen.findByRole('button', { name: `${symbol} actions` });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

describe('watchlist rows on a touch screen (NSTOCK-0470)', () => {
  it('give every row a visible actions button in place of the hover buttons and grip', async () => {
    touchScreen();
    renderRows();
    const list = await screen.findByRole('list', { name: 'Stocks in My list' });
    for (const { symbol } of items)
      expect(within(list).getByRole('button', { name: `${symbol} actions` })).toBeVisible();
    expect(within(list).queryByRole('button', { name: 'Buy INFY' })).toBeNull();
    expect(list.querySelector('[data-drag-handle]')).toBeNull();
  });

  it('buy, sell and remove from the menu', async () => {
    touchScreen();
    const { onTrade, onRemove } = renderRows();
    fireEvent.click(within(await openActions('TCS')).getByRole('menuitem', { name: 'Buy TCS' }));
    expect(onTrade).toHaveBeenCalledWith(items[1], 'BUY');
    fireEvent.click(within(await openActions('TCS')).getByRole('menuitem', { name: 'Sell TCS' }));
    expect(onTrade).toHaveBeenCalledWith(items[1], 'SELL');
    fireEvent.click(
      within(await openActions('TCS')).getByRole('menuitem', { name: /Remove from list/ }),
    );
    expect(onRemove).toHaveBeenCalledWith(items[1]);
  });

  it('moves a row up or down without a drag, and not past either end', async () => {
    touchScreen();
    const { onReorder } = renderRows();
    fireEvent.click(within(await openActions('TCS')).getByRole('menuitem', { name: /Move up/ }));
    expect(onReorder).toHaveBeenCalledWith(1, 0);
    const first = await openActions('INFY');
    expect(within(first).getByRole('menuitem', { name: /Move up/ })).toHaveAttribute(
      'data-disabled',
    );
    fireEvent.click(within(first).getByRole('menuitem', { name: /Move down/ }));
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('offers no moves when the list is sorted', async () => {
    touchScreen();
    renderRows({ reorderable: false });
    const menu = await openActions('INFY');
    expect(within(menu).queryByRole('menuitem', { name: /Move/ })).toBeNull();
  });
});
