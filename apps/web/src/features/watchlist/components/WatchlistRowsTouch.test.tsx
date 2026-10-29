import type { WatchlistItem } from '@nthstock/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubTouchScreen } from '@/test/matchMedia';
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

let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = fakeLayout(VISIBLE_ROWS * ROW_HEIGHT);
});
afterAll(() => restoreLayout());
beforeEach(() => stubTouchScreen());
afterEach(() => vi.unstubAllGlobals());

function renderRows({ reorderable = true, list = items } = {}) {
  const handlers = {
    onReorder: vi.fn(),
    onReorderBlocked: vi.fn(),
    onTrade: vi.fn(),
    onRemove: vi.fn(),
  };
  renderWithProviders(
    <WatchlistRows
      label="Stocks in My list"
      items={list}
      snapshot={new Map()}
      reorderable={reorderable}
      {...handlers}
    />,
  );
  return handlers;
}

/** Opens a row's menu with one tap, as on a phone. */
async function tapActions(symbol: string) {
  const trigger = await screen.findByRole('button', { name: `${symbol} actions` });
  await userEvent.click(trigger);
  return screen.findByRole('menu');
}

describe('watchlist rows on a touch screen (NSTOCK-0470)', () => {
  it('give every row a visible actions button in place of the hover buttons and grip', async () => {
    renderRows();
    const list = await screen.findByRole('list', { name: 'Stocks in My list' });
    for (const { symbol } of items)
      expect(within(list).getByRole('button', { name: `${symbol} actions` })).toBeVisible();
    expect(within(list).queryByRole('button', { name: 'Buy INFY' })).toBeNull();
    expect(list.querySelector('[data-drag-handle]')).toBeNull();
  });

  it('opens the menu with one tap and buys, sells and removes from it', async () => {
    const { onTrade, onRemove } = renderRows();
    await userEvent.click(
      within(await tapActions('TCS')).getByRole('menuitem', { name: 'Buy TCS' }),
    );
    expect(onTrade).toHaveBeenCalledWith(items[1], 'BUY');
    await userEvent.click(
      within(await tapActions('TCS')).getByRole('menuitem', { name: 'Sell TCS' }),
    );
    expect(onTrade).toHaveBeenCalledWith(items[1], 'SELL');
    await userEvent.click(
      within(await tapActions('TCS')).getByRole('menuitem', { name: 'Remove TCS' }),
    );
    expect(onRemove).toHaveBeenCalledWith(items[1]);
  });

  it('opens the menu from the keyboard too', async () => {
    renderRows();
    const trigger = await screen.findByRole('button', { name: 'INFY actions' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Buy INFY' })).toBeInTheDocument();
  });

  it('moves a row up or down without a drag, and says why not at either end', async () => {
    const { onReorder } = renderRows();
    await userEvent.click(
      within(await tapActions('TCS')).getByRole('menuitem', { name: /Move up/ }),
    );
    expect(onReorder).toHaveBeenCalledWith(1, 0);
    // Focus goes back to the moved row's actions button, so Move can be tapped again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'TCS actions' })).toHaveFocus());

    const first = await tapActions('INFY');
    expect(within(first).getByRole('menuitem', { name: /Already first/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(within(first).getByRole('menuitem', { name: /Move down/ }));
    expect(onReorder).toHaveBeenCalledWith(0, 1);

    const last = await tapActions('ITC');
    expect(within(last).getByRole('menuitem', { name: /Already last/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(last).getByRole('menuitem', { name: /Move up/ })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('on a sorted list keeps Buy, Sell and Remove and says how to reorder', async () => {
    renderRows({ reorderable: false });
    const menu = await tapActions('INFY');
    expect(within(menu).queryByRole('menuitem', { name: /Move/ })).toBeNull();
    for (const name of ['Buy INFY', 'Sell INFY', 'Remove INFY'])
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    // A hint, not an action.
    expect(
      within(menu).getByRole('menuitem', { name: 'To reorder, choose Custom order in Sort' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('after Remove, focuses the row that takes its place', async () => {
    /** The rows with a parent that really drops the removed one. */
    function Harness() {
      const [list, setList] = useState(items);
      return (
        <WatchlistRows
          label="Stocks in My list"
          items={list}
          snapshot={new Map()}
          reorderable
          onReorder={vi.fn()}
          onReorderBlocked={vi.fn()}
          onTrade={vi.fn()}
          onRemove={(item) => setList((current) => current.filter((row) => row !== item))}
        />
      );
    }
    renderWithProviders(<Harness />);
    await userEvent.click(
      within(await tapActions('TCS')).getByRole('menuitem', { name: 'Remove TCS' }),
    );
    await waitFor(() => expect(screen.getByRole('link', { name: /^ITC NSE/ })).toHaveFocus());
  });
});
