import type { WatchlistItem } from '@nthstock/contracts';

/** How the rows are ordered (T-123). `custom` is the saved order the user dragged into place. */
export type WatchlistSort = 'custom' | 'name' | 'ltp' | 'change';

export const WATCHLIST_SORTS: readonly WatchlistSort[] = ['custom', 'name', 'ltp', 'change'];

export const isWatchlistSort = (value: unknown): value is WatchlistSort =>
  typeof value === 'string' && (WATCHLIST_SORTS as readonly string[]).includes(value);

/** The price facts a sort needs: last price in paise and day change in basis points. */
export type SortQuote = { ltp: number; changeBp: number };

/**
 * The rows in `sort` order. Name sorts A to Z by symbol; last price and % change sort high to low.
 * A stock with no price yet goes last, so it does not jump to the top when its first quote lands.
 * Ties keep the saved order (the sort is stable).
 */
export function sortItems<T extends Pick<WatchlistItem, 'symbol'>>(
  items: readonly T[],
  sort: WatchlistSort,
  quoteOf: (item: T) => SortQuote | undefined,
): T[] {
  if (sort === 'custom') return [...items];
  if (sort === 'name') {
    return [...items].sort((a, b) => a.symbol.localeCompare(b.symbol, 'en-IN'));
  }
  const field = sort === 'ltp' ? 'ltp' : 'changeBp';
  const keyed = items.map((item) => ({ item, value: quoteOf(item)?.[field] }));
  keyed.sort((a, b) => {
    if (a.value === undefined) return b.value === undefined ? 0 : 1;
    if (b.value === undefined) return -1;
    return b.value - a.value;
  });
  return keyed.map(({ item }) => item);
}

/** `values` with the entry at `from` moved to `to` (both clamped to the array). */
export function moveItem<T>(values: readonly T[], from: number, to: number): T[] {
  const next = [...values];
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...values];
  next.splice(target, 0, moved);
  return next;
}
