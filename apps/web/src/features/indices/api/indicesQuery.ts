import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

export const indicesKeys = {
  all: ['indices'] as const,
  summaries: () => ['indices', 'summaries', {}] as const,
};

/** `GET /v1/market/indices`: every index card with its intraday sparkline (ADR 0005 factory). */
export function indicesQuery(api: ApiClient) {
  return queryOptions({
    queryKey: indicesKeys.summaries(),
    queryFn: ({ signal }) => api.request('marketIndices', { signal }),
    // Levels tick through the quote store; the sparkline only needs an occasional refresh.
    staleTime: 60_000,
  });
}
