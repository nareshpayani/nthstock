import { sameWatchlistName, type Watchlist } from '@nthstock/contracts';
import { useWatchlistUiStore } from '../store/watchlistUiStore';
import { useWatchlists } from './useWatchlists';

/** The lists query and the open tab's list: the remembered one (by id, else name), else the first. */
export function useActiveWatchlist() {
  const query = useWatchlists();
  const activeListId = useWatchlistUiStore((s) => s.activeListId);
  const activeListName = useWatchlistUiStore((s) => s.activeListName);
  const lists: readonly Watchlist[] = query.data?.items ?? [];
  const active =
    lists.find((list) => list.id === activeListId) ??
    (activeListName === null
      ? undefined
      : lists.find((list) => sameWatchlistName(list.name, activeListName))) ??
    lists[0];
  return { query, lists, active };
}
