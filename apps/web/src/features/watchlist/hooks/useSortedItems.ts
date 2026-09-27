import { quoteKey } from '@nthstock/apiClient';
import type { Quote, WatchlistItem } from '@nthstock/contracts';
import { useEffect, useEffectEvent, useState } from 'react';
import { useQuoteStore } from '@/shared/lib/quoteStoreContext';
import { sortItems, type WatchlistSort } from '../model/sortItems';

/** Price sorts re-sort at most this often, so rows do not jump on every tick (T-123). */
export const RESORT_MS = 2_000;

type Sorted<T> = { items: readonly T[]; sort: WatchlistSort; order: T[] };

/**
 * The list's rows in `sort` order. Prices come from the quote store (rows on screen) or the REST
 * snapshot (rows scrolled away). They are read, not subscribed: a tick re-renders only its price
 * cell, and a price sort re-runs on a 2 s beat. A new sort or a changed list applies at once.
 */
export function useSortedItems<T extends WatchlistItem>(
  items: readonly T[],
  sort: WatchlistSort,
  snapshot: ReadonlyMap<string, Quote>,
): T[] {
  const store = useQuoteStore();
  const quoteOf = (item: T) =>
    store.get(item.symbol, item.exchange)?.quote ??
    snapshot.get(quoteKey(item.symbol, item.exchange));
  const [sorted, setSorted] = useState<Sorted<T>>(() => ({
    items,
    sort,
    order: sortItems(items, sort, quoteOf),
  }));

  const resort = useEffectEvent(() => {
    setSorted((current) => ({
      ...current,
      order: sortItems(current.items, current.sort, quoteOf),
    }));
  });
  const byPrice = sort === 'ltp' || sort === 'change';
  useEffect(() => {
    if (!byPrice) return undefined;
    const timer = setInterval(resort, RESORT_MS);
    return () => clearInterval(timer);
  }, [byPrice]);

  if (sorted.items !== items || sorted.sort !== sort) {
    // A new list or sort: re-sort now (state adjusted during render, as React recommends).
    const next = { items, sort, order: sortItems(items, sort, quoteOf) };
    setSorted(next);
    return next.order;
  }
  return sorted.order;
}
