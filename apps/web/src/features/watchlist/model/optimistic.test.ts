import type { Watchlist, WatchlistItem } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  OPTIMISTIC_ID_PREFIX,
  listsContaining,
  withCreatedList,
  withItemAdded,
  withItemRemoved,
  withItemsReordered,
  withListAdded,
  withListDeleted,
  withListFromServer,
  withListRenamed,
  withListsReordered,
} from './optimistic';

const TS = '2026-09-25T04:00:00.000Z';
const watchlistItemFixture = (token: number): WatchlistItem => ({
  token,
  symbol: `SYM${String(token)}`,
  exchange: 'NSE',
  name: `Company ${String(token)}`,
  addedAt: TS,
});
const watchlistFixture: Watchlist = {
  id: 'wl_1',
  name: 'My Watchlist',
  items: [watchlistItemFixture(1), watchlistItemFixture(2)],
  createdAt: TS,
  updatedAt: TS,
};
const second = { ...watchlistFixture, id: 'wl_2', name: 'Banks', items: [] };
const data = { items: [watchlistFixture, second] };
const tokens = (id: string, d = data) =>
  d.items.find((l) => l.id === id)?.items.map((i) => i.token);

describe('optimistic watchlist updates', () => {
  it('adds, renames, deletes and reorders lists without touching the input', () => {
    const stand = { ...second, id: `${OPTIMISTIC_ID_PREFIX}1`, name: 'IT' };
    expect(withListAdded(data, stand).items.map((l) => l.id)).toEqual(['wl_1', 'wl_2', stand.id]);
    expect(withListRenamed(data, 'wl_2', 'PSU').items[1]?.name).toBe('PSU');
    expect(withListDeleted(data, 'wl_1').items.map((l) => l.id)).toEqual(['wl_2']);
    expect(withListsReordered(data, ['wl_2', 'wl_1']).items.map((l) => l.id)).toEqual([
      'wl_2',
      'wl_1',
    ]);
    // A list the order does not name keeps its place after the named ones.
    expect(withListsReordered(data, ['wl_2']).items.map((l) => l.id)).toEqual(['wl_2', 'wl_1']);
    expect(data.items.map((l) => l.id)).toEqual(['wl_1', 'wl_2']);
  });

  it('swaps the optimistic stand-in for the created list by name', () => {
    const stand = { ...second, id: `${OPTIMISTIC_ID_PREFIX}7`, name: 'IT' };
    const created = { ...second, id: 'wl_9', name: 'IT' };
    const next = withCreatedList(withListAdded(data, stand), created);
    expect(next.items.map((l) => l.id)).toEqual(['wl_1', 'wl_2', 'wl_9']);
  });

  it('replaces a list with the server copy', () => {
    const server = { ...second, name: 'Server name' };
    expect(withListFromServer(data, server).items[1]).toBe(server);
  });

  it('adds an item once, removes and reorders items', () => {
    const three = watchlistItemFixture(3);
    expect(tokens('wl_1', withItemAdded(data, 'wl_1', three))).toEqual([1, 2, 3]);
    expect(tokens('wl_1', withItemAdded(data, 'wl_1', watchlistItemFixture(1)))).toEqual([1, 2]);
    expect(tokens('wl_1', withItemRemoved(data, 'wl_1', 1))).toEqual([2]);
    expect(tokens('wl_1', withItemsReordered(data, 'wl_1', [2, 1]))).toEqual([2, 1]);
    expect(withItemAdded(data, 'wl_nope', three)).toEqual(data);
  });

  it('finds the lists holding a stock', () => {
    expect(listsContaining(data, 1)).toEqual(['wl_1']);
    expect(listsContaining(data, 99)).toEqual([]);
    expect(listsContaining(undefined, 1)).toEqual([]);
  });
});
