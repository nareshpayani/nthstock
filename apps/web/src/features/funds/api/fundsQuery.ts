import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

/** Query keys for paper funds (ADR 0005). Placing an order invalidates `fundsKeys.all`. */
export const fundsKeys = {
  all: ['funds'] as const,
  summary: () => ['funds', 'summary'] as const,
};

/** `GET /v1/funds`: balance, blocked and available paper cash in paise. */
export function fundsSummaryQuery(api: ApiClient) {
  return queryOptions({
    queryKey: fundsKeys.summary(),
    queryFn: ({ signal }) => api.request('fundsSummary', { signal }),
    staleTime: 10_000,
  });
}
