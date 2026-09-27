import type { SearchHit } from '@nthstock/contracts';
import { useSession } from '@/shared/hooks/useSession';
import { useWatchlistUiStore } from '../store/watchlistUiStore';
import { strings } from '../strings';
import { useActiveWatchlist } from './useActiveWatchlist';
import { useAddToWatchlist } from './useWatchlistMutations';

export type WatchlistAdder = {
  listName: string;
  has: (hit: Pick<SearchHit, 'token'>) => boolean;
  add: (hit: Pick<SearchHit, 'token' | 'symbol' | 'exchange' | 'name'>) => void;
};

/**
 * Adds stocks to the open watchlist tab (T-121), for search results. `null` while logged out or
 * before the lists load. The row shows at once (optimistic); a failure rolls back with a toast.
 */
export function useWatchlistAdder(): WatchlistAdder | null {
  const { status } = useSession();
  const { active } = useActiveWatchlist();
  const { mutate } = useAddToWatchlist();
  const announce = useWatchlistUiStore((s) => s.announce);
  if (status !== 'authenticated' || !active) return null;
  const has = (hit: Pick<SearchHit, 'token'>) => active.items.some((i) => i.token === hit.token);
  return {
    listName: active.name,
    has,
    add: (hit) => {
      if (has(hit)) {
        announce(strings.announce.alreadyIn(hit.symbol, active.name));
        return;
      }
      mutate({ listId: active.id, stock: hit });
      announce(strings.announce.added(hit.symbol, active.name));
    },
  };
}
