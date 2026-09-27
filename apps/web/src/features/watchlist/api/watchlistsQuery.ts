import type { ApiClient } from '@nthstock/apiClient';
import type { Exchange } from '@nthstock/contracts';
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

/**
 * `GET /v1/market/quotes` for one exchange's stocks of a list: the prices rows show before their
 * first live tick, and the prices a sort uses for rows scrolled out of view (those are not
 * subscribed to live quotes, T-124). At most 50 stocks per list, so one request per exchange.
 */
export function listQuotesQuery(api: ApiClient, exchange: Exchange, symbols: readonly string[]) {
  const sorted = [...symbols].sort();
  return queryOptions({
    queryKey: ['watchlist', 'quotes', { exchange, symbols: sorted.join(',') }] as const,
    queryFn: async ({ signal }) => {
      const response = await api.request('marketQuotes', {
        query: { symbols: sorted.join(','), exchange },
        signal,
      });
      return response.items;
    },
  });
}
