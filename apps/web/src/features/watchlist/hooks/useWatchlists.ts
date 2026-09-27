import type { WatchlistsResponse } from '@nthstock/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/shared/hooks/useSession';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { watchlistsQuery } from '../api/watchlistsQuery';
import { listsContaining } from '../model/optimistic';

/** The lists query, idle while logged out: the lists are private. */
function useWatchlistsOptions() {
  const apiClient = useApiClient();
  const { status } = useSession();
  return { ...watchlistsQuery(apiClient), enabled: status === 'authenticated' };
}

/** The signed-in user's watchlists in display order (T-118). */
export function useWatchlists() {
  return useQuery(useWatchlistsOptions());
}

/** Ids of the lists holding `token`, from the cache; empty while loading or logged out. */
export function useWatchlistMembership(token: number): string[] {
  const { data } = useQuery({
    ...useWatchlistsOptions(),
    select: (lists: WatchlistsResponse) => listsContaining(lists, token),
  });
  return data ?? [];
}
