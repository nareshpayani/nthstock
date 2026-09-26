import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

/** Results shown in the search dropdown. */
export const SEARCH_RESULTS_LIMIT = 8;

export const searchKeys = {
  all: ['search'] as const,
  results: (q: string) => ['search', 'results', { q, limit: SEARCH_RESULTS_LIMIT }] as const,
  popular: () => ['search', 'popular'] as const,
};

/** `GET /v1/market/search?q=&limit=8` (ADR 0005 factory). The symbol master rarely changes. */
export function searchQuery(api: ApiClient, q: string) {
  return queryOptions({
    queryKey: searchKeys.results(q),
    queryFn: ({ signal }) =>
      api.request('marketSearch', { query: { q, limit: SEARCH_RESULTS_LIMIT }, signal }),
    staleTime: 5 * 60_000,
  });
}

/** `GET /v1/market/search/popular` (T-102): today's most traded equities. */
export function popularSearchesQuery(api: ApiClient) {
  return queryOptions({
    queryKey: searchKeys.popular(),
    queryFn: ({ signal }) => api.request('marketSearchPopular', { signal }),
    staleTime: 5 * 60_000,
  });
}
