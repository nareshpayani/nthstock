import type { WatchlistItem } from '@nthstock/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { touchScreen } from '@/test/touchScreen';
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

/** Opens a row's menu with a tap (a pointer click) or from the keyboard. */
async function openActions(symbol: string, how: 'tap' | 'keyboard' = 'tap') {
  const trigger = await screen.findByRole('button', { name: `${symbol} actions` });
  if (how === 'tap') await userEvent.click(trigger);
  else {
    trigger.focus();
    await userEvent.keyboard('{Enter}');
  }
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

  it('keeps the hover buttons and grip, and no actions button, with a mouse', async () => {
    renderRows();
    const list = await screen.findByRole('list', { name: 'Stocks in My list' });
    expect(within(list).queryByRole('button', { name: 'INFY actions' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Buy INFY' })).toBeInTheDocument();
    expect(list.querySelector('[data-drag-handle]')).not.toBeNull();
  });

  it('buy, sell and remove from the menu, opened by a tap', async () => {
    touchScreen();
    const { onTrade, onRemove } = renderRows();
    await userEvent.click(
      within(await openActions('TCS')).getByRole('menuitem', { name: 'Buy TCS' }),
    );
    expect(onTrade).toHaveBeenCalledWith(items[1], 'BUY');
    await userEvent.click(
      within(await openActions('TCS')).getByRole('menuitem', { name: 'Sell TCS' }),
    );
    expect(onTrade).toHaveBeenCalledWith(items[1], 'SELL');
    await userEvent.click(
      within(await openActions('TCS')).getByRole('menuitem', { name: /Remove from list/ }),
    );
    expect(onRemove).toHaveBeenCalledWith(items[1]);
  });

  it('opens from the keyboard too', async () => {
    touchScreen();
    const { onTrade } = renderRows();
    const menu = await openActions('INFY', 'keyboard');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Buy INFY' }));
    expect(onTrade).toHaveBeenCalledWith(items[0], 'BUY');
  });

  it('moves a row up or down without a drag, and not past either end', async () => {
    touchScreen();
    const { onReorder } = renderRows();
    await userEvent.click(
      within(await openActions('TCS')).getByRole('menuitem', { name: /Move up/ }),
    );
    expect(onReorder).toHaveBeenCalledWith(1, 0);
    const first = await openActions('INFY');
    expect(within(first).getByRole('menuitem', { name: /Move up/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(within(first).getByRole('menuitem', { name: /Move down/ }));
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('disables Move down on the last row only', async () => {
    touchScreen();
    renderRows();
    const menu = await openActions('ITC');
    expect(within(menu).getByRole('menuitem', { name: /Move down/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menu).getByRole('menuitem', { name: /Move up/ })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('offers no moves when the list is sorted, but keeps Buy, Sell and Remove', async () => {
    touchScreen();
    renderRows({ reorderable: false });
    const menu = await openActions('INFY');
    expect(within(menu).queryByRole('menuitem', { name: /Move/ })).toBeNull();
    for (const name of [/Buy INFY/, /Sell INFY/, /Remove from list/])
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
  });
});
