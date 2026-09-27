import {
  sameWatchlistName,
  type Watchlist,
  type WatchlistItem,
  type WatchlistsResponse,
} from '@nthstock/contracts';

/**
 * Pure cache updates for optimistic watchlist changes (T-118). Each takes the cached
 * `WatchlistsResponse` and returns a new one; an unknown list id leaves the data as it was.
 */

const mapList = (
  data: WatchlistsResponse,
  id: string,
  change: (list: Watchlist) => Watchlist,
): WatchlistsResponse => ({
  items: data.items.map((list) => (list.id === id ? change(list) : list)),
});

/** Puts `order` first, in that order; anything not named keeps its place after them. */
function reorderBy<T, K>(values: readonly T[], keyOf: (value: T) => K, order: readonly K[]): T[] {
  const byKey = new Map(values.map((value) => [keyOf(value), value]));
  const ordered = order.flatMap((key) => byKey.get(key) ?? []);
  const named = new Set(order);
  return [...ordered, ...values.filter((value) => !named.has(keyOf(value)))];
}

export const withListAdded = (data: WatchlistsResponse, list: Watchlist): WatchlistsResponse => ({
  items: [...data.items, list],
});

export const withListRenamed = (data: WatchlistsResponse, id: string, name: string) =>
  mapList(data, id, (list) => ({ ...list, name }));

export const withListDeleted = (data: WatchlistsResponse, id: string): WatchlistsResponse => ({
  items: data.items.filter((list) => list.id !== id),
});

export const withListsReordered = (
  data: WatchlistsResponse,
  ids: readonly string[],
): WatchlistsResponse => ({ items: reorderBy(data.items, (list) => list.id, ids) });

/** Id prefix of a list created optimistically, until the server's copy replaces it. */
export const OPTIMISTIC_ID_PREFIX = 'optimistic_';

/** Replaces the list with the server's copy. */
export const withListFromServer = (data: WatchlistsResponse, list: Watchlist) =>
  mapList(data, list.id, () => list);

/**
 * Swaps the optimistic stand-in of a new list for the server's copy. Names are unique, so the
 * stand-in with the same name is the one.
 */
export const withCreatedList = (data: WatchlistsResponse, list: Watchlist): WatchlistsResponse => ({
  items: data.items.map((current) =>
    current.id.startsWith(OPTIMISTIC_ID_PREFIX) && sameWatchlistName(current.name, list.name)
      ? list
      : current,
  ),
});

export const withItemAdded = (data: WatchlistsResponse, id: string, item: WatchlistItem) =>
  mapList(data, id, (list) =>
    list.items.some((i) => i.token === item.token)
      ? list
      : { ...list, items: [...list.items, item] },
  );

export const withItemRemoved = (data: WatchlistsResponse, id: string, token: number) =>
  mapList(data, id, (list) => ({ ...list, items: list.items.filter((i) => i.token !== token) }));

export const withItemsReordered = (
  data: WatchlistsResponse,
  id: string,
  tokens: readonly number[],
) =>
  mapList(data, id, (list) => ({ ...list, items: reorderBy(list.items, (i) => i.token, tokens) }));

/** The ids of the lists that hold `token` (the stock detail star, T-121). */
export const listsContaining = (data: WatchlistsResponse | undefined, token: number): string[] =>
  (data?.items ?? []).filter((list) => list.items.some((i) => i.token === token)).map((l) => l.id);
