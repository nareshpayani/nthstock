import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

export const watchlistKeys = {
  all: ['watchlist'] as const,
  lists: () => ['watchlist', 'lists', {}] as const,
};

/** Mutation key shared by every watchlist change, so the last one to settle refetches (T-118). */
export const WATCHLIST_MUTATION_KEY = ['watchlist', 'mutation'] as const;

/** `GET /v1/watchlists` (ADR 0005 factory): the signed-in user's lists in display order. */
export function watchlistsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: watchlistKeys.lists(),
    queryFn: ({ signal }) => api.request('watchlistsList', { signal }),
  });
}
