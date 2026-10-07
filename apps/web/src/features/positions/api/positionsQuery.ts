import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

import { positionsKeys } from '@/shared/lib/queryKeys';

/** `GET /v1/positions`: today's positions, marked to the LTP when they were read. */
export function positionsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: positionsKeys.list(),
    queryFn: ({ signal }) => api.request('positionsList', { signal }),
    staleTime: 10_000,
  });
}
