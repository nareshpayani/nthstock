import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';

export const collectionsKeys = {
  all: ['collections'] as const,
  list: (id: string) => ['collections', 'list', { id }] as const,
};

/** `GET /v1/market/lists/:id`: one curated list with its rows (ADR 0005 factory). */
export function listQuery(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: collectionsKeys.list(id),
    queryFn: ({ signal }) => api.request('marketList', { params: { id }, signal }),
    // Prices tick through the quote store; membership changes slowly.
    staleTime: 60_000,
  });
}
