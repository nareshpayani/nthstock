import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

/** Query keys for positions (ADR 0005). Every `orderUpdate` invalidates `positionsKeys.all`. */
export const positionsKeys = {
  all: ['positions'] as const,
  list: () => ['positions', 'list'] as const,
};

/** `GET /v1/positions`: today's positions, marked to the LTP when they were read. */
export function positionsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: positionsKeys.list(),
    queryFn: ({ signal }) => api.request('positionsList', { signal }),
    staleTime: 10_000,
  });
}
