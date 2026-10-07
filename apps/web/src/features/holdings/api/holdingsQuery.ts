import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

import { holdingsKeys } from '@/shared/lib/queryKeys';

/** `GET /v1/holdings`: delivery holdings, valued at the LTP when they were read. */
export function holdingsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: holdingsKeys.list(),
    queryFn: ({ signal }) => api.request('holdingsList', { signal }),
    staleTime: 10_000,
  });
}

/** `GET /v1/portfolio/summary`: totals over the holdings. */
export function portfolioSummaryQuery(api: ApiClient) {
  return queryOptions({
    queryKey: holdingsKeys.summary(),
    queryFn: ({ signal }) => api.request('portfolioSummary', { signal }),
    staleTime: 10_000,
  });
}
