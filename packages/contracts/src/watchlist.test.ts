import { describe, expect, it } from 'vitest';
import { watchlistFixture, watchlistItemFixture } from './fixtures.js';
import {
  AddWatchlistItemRequest,
  CreateWatchlistRequest,
  RenameWatchlistRequest,
  ReorderWatchlistItemsRequest,
  ReorderWatchlistsRequest,
  WATCHLIST_MAX_ITEMS,
  WATCHLIST_MAX_LISTS,
  Watchlist,
  WatchlistItem,
  WatchlistItemParams,
  WatchlistsResponse,
} from './watchlist.js';

const items = (count: number) =>
  Array.from({ length: count }, (_, i) => watchlistItemFixture(i + 1));
const lists = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ ...watchlistFixture, id: `wl_${i}` }));

describe('watchlist fixtures round-trip', () => {
  it.each([
    ['WatchlistItem', WatchlistItem, watchlistItemFixture(1)],
    ['Watchlist', Watchlist, watchlistFixture],
    ['WatchlistsResponse', WatchlistsResponse, { items: [watchlistFixture] }],
    ['CreateWatchlistRequest', CreateWatchlistRequest, { name: 'Banks' }],
    ['RenameWatchlistRequest', RenameWatchlistRequest, { name: 'Long term' }],
    ['ReorderWatchlistsRequest', ReorderWatchlistsRequest, { ids: ['wl_2', 'wl_1'] }],
    ['AddWatchlistItemRequest', AddWatchlistItemRequest, { token: 408065 }],
    ['ReorderWatchlistItemsRequest', ReorderWatchlistItemsRequest, { tokens: [2, 1] }],
  ] as const)('%s', (_name, schema, fixture) => {
    expect(schema.parse(fixture)).toEqual(fixture);
  });
});

describe('watchlist limits', () => {
  it('exports 10 lists and 50 items', () => {
    expect(WATCHLIST_MAX_LISTS).toBe(10);
    expect(WATCHLIST_MAX_ITEMS).toBe(50);
  });

  it('accepts a 50-item list and rejects a 51-item list', () => {
    expect(Watchlist.safeParse({ ...watchlistFixture, items: items(50) }).success).toBe(true);
    const result = Watchlist.safeParse({ ...watchlistFixture, items: items(51) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('A watchlist can hold up to 50 stocks');
  });

  it('accepts 10 lists and rejects 11', () => {
    expect(WatchlistsResponse.safeParse({ items: lists(10) }).success).toBe(true);
    expect(WatchlistsResponse.safeParse({ items: lists(11) }).success).toBe(false);
  });

  it('rejects the same stock twice', () => {
    const one = watchlistItemFixture(1);
    expect(Watchlist.safeParse({ ...watchlistFixture, items: [one, one] }).success).toBe(false);
  });
});

describe('watchlist requests', () => {
  it('trims names and rejects empty or long ones', () => {
    expect(CreateWatchlistRequest.parse({ name: '  Banks  ' })).toEqual({ name: 'Banks' });
    expect(CreateWatchlistRequest.safeParse({ name: '   ' }).success).toBe(false);
    expect(RenameWatchlistRequest.safeParse({ name: 'x'.repeat(31) }).success).toBe(false);
  });

  it('rejects duplicate or oversized reorders', () => {
    expect(ReorderWatchlistItemsRequest.safeParse({ tokens: [1, 1] }).success).toBe(false);
    expect(
      ReorderWatchlistItemsRequest.safeParse({
        tokens: Array.from({ length: 51 }, (_, i) => i + 1),
      }).success,
    ).toBe(false);
    expect(ReorderWatchlistsRequest.safeParse({ ids: ['a', 'a'] }).success).toBe(false);
  });

  it('coerces the item token path param', () => {
    expect(WatchlistItemParams.parse({ id: 'wl_1', token: '408065' })).toEqual({
      id: 'wl_1',
      token: 408065,
    });
    expect(WatchlistItemParams.safeParse({ id: 'wl_1', token: 'abc' }).success).toBe(false);
    expect(WatchlistItemParams.safeParse({ id: 'wl_1', token: '1.5' }).success).toBe(false);
  });
});
