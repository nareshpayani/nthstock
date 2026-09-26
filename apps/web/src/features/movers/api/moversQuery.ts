import type { ApiClient } from '@nthstock/apiClient';
import type { MoverDirection } from '@nthstock/contracts';
import { queryOptions } from '@tanstack/react-query';

export type MoversParams = { index: string; direction: MoverDirection; limit: number };

export const moversKeys = {
  all: ['movers'] as const,
  list: (params: MoversParams) => ['movers', 'list', params] as const,
};

/** `GET /v1/market/movers?index=&direction=&limit=` (ADR 0005 factory). */
export function moversQuery(api: ApiClient, params: MoversParams) {
  return queryOptions({
    queryKey: moversKeys.list(params),
    queryFn: ({ signal }) => api.request('marketMovers', { query: params, signal }),
    // The ranking moves with the market; prices in the rows tick live regardless.
    staleTime: 30_000,
  });
}
