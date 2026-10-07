import type { ApiClient } from '@nthstock/apiClient';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { fundsKeys } from '@/shared/lib/queryKeys';

/** Ledger entries per page (T-159). */
export const LEDGER_PAGE_SIZE = 50;

/** `GET /v1/funds`: balance, blocked and available paper cash in paise. */
export function fundsSummaryQuery(api: ApiClient) {
  return queryOptions({
    queryKey: fundsKeys.summary(),
    queryFn: ({ signal }) => api.request('fundsSummary', { signal }),
    staleTime: 10_000,
  });
}

/** `GET /v1/funds/ledger`: the ledger newest first, one cursor page at a time (T-159). */
export function fundsLedgerQuery(api: ApiClient) {
  return infiniteQueryOptions({
    queryKey: fundsKeys.ledger(),
    queryFn: ({ pageParam, signal }) =>
      api.request('fundsLedger', {
        query: { limit: LEDGER_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 10_000,
  });
}
