import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';
import { activeSessionsKeys } from '@/shared/lib/queryKeys';

/** `GET /v1/auth/sessions`: the user's live sessions, most recently active first. */
export function activeSessionsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: activeSessionsKeys.list(),
    queryFn: ({ signal }) => api.request('sessionsList', { signal }),
    staleTime: 30_000,
  });
}
