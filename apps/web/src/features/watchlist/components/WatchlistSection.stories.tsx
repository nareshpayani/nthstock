import type { Watchlist, WatchlistsResponse } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { StoryProviders } from '@/mocks/storyMarket';
import { signIn, signOut, testSession } from '@/test/session';
import { watchlistKeys } from '../api/watchlistsQuery';
import type { WatchlistSort } from '../model/sortItems';
import { initialWatchlistUiState, useWatchlistUiStore } from '../store/watchlistUiStore';
import { WatchlistSection } from './WatchlistSection';
import { WatchlistSortMenu } from './WatchlistSortMenu';
import { WatchlistStar } from './WatchlistStar';

const TS = '2026-09-25T04:00:00.000Z';

const list = (id: string, name: string, symbols: readonly string[]): Watchlist => ({
  id,
  name,
  items: symbols.map((symbol, index) => ({
    token: 9000 + index,
    symbol,
    exchange: 'NSE',
    name: symbol,
    addedAt: TS,
  })),
  createdAt: TS,
  updatedAt: TS,
});

/** Puts the lists in the query cache (no watchlist backend in stories) before the rail renders. */
function Seed({ lists, children }: { lists: WatchlistsResponse | null; children: ReactNode }) {
  const queryClient = useQueryClient();
  useState(() => {
    if (!lists) return null;
    queryClient.setQueryDefaults(watchlistKeys.all, { staleTime: Infinity });
    queryClient.setQueryData(watchlistKeys.lists(), lists);
    return null;
  });
  return children;
}

type DemoProps = { lists: WatchlistsResponse | null; sort?: WatchlistSort };

function Demo({ lists, sort = 'custom' }: DemoProps) {
  useState(() => {
    useWatchlistUiStore.setState({ ...initialWatchlistUiState(), activeListId: null, sort });
    if (lists) signIn(testSession());
    else signOut();
    return null;
  });
  return (
    <StoryProviders>
      <Seed lists={lists}>
        <div className="grid w-80 gap-4 bg-surface p-4">
          <div className="flex justify-end">
            <WatchlistSortMenu />
          </div>
          <WatchlistSection onAddStock={() => undefined} />
        </div>
      </Seed>
    </StoryProviders>
  );
}

const meta = { title: 'Watchlist/WatchlistSection', component: Demo } satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const seeded: WatchlistsResponse = {
  items: [
    list('wl_1', 'My Watchlist', ['INFY', 'TCS', 'SBIN', 'HDFCBANK', 'RELIANCE']),
    list('wl_2', 'Banks', ['HDFCBANK', 'SBIN']),
  ],
};

/** Logged out: an invitation to log in that comes back to this page. */
export const LoggedOut: Story = { args: { lists: null } };

/** A new user: the default list, empty, with Add stock (focuses search). */
export const Empty: Story = { args: { lists: { items: [list('wl_1', 'My Watchlist', [])] } } };

/**
 * Named lists as tabs and live rows: symbol, exchange, price and ▲▼ change. Hover or focus a row
 * for B, S and remove; the grip (custom order) drags it, Alt+↑/↓ moves it from the keyboard.
 */
export const Seeded: Story = { args: { lists: seeded } };

/** Sorted by % change (high to low): re-sorted every 2 s, no drag handles. */
export const SortedByChange: Story = { args: { lists: seeded, sort: 'change' } };

function StarDemo({ inList }: { inList: boolean }) {
  useState(() => {
    signIn(testSession());
    return null;
  });
  return (
    <StoryProviders>
      <Seed lists={{ items: [list('wl_1', 'My Watchlist', inList ? ['INFY'] : [])] }}>
        <div className="bg-surface p-4">
          <WatchlistStar
            instrument={{ token: 9000, symbol: 'INFY', exchange: 'NSE', name: 'Infosys Ltd' }}
          />
        </div>
      </Seed>
    </StoryProviders>
  );
}

/** The stock detail star, outlined: the stock is in no list. Its menu ticks lists. */
export const StarNotInList: Story = {
  args: { lists: null },
  render: () => <StarDemo inList={false} />,
};

/** The stock detail star, filled: the stock is in a list. */
export const StarInList: Story = {
  args: { lists: null },
  render: () => <StarDemo inList />,
};
