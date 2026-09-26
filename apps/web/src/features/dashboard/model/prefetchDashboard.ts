import type { ApiClient } from '@nthstock/apiClient';
import type { QueryClient } from '@tanstack/react-query';
import { DEFAULT_CHART_RANGE, NIFTY, candlesQuery } from '@/features/charts';
import { listQuery, resolveListId } from '@/features/collections';
import { indicesQuery } from '@/features/indices';
import type { DashboardSearch } from './dashboardSearch';

/**
 * Route loader work: start every section's first request while the page chunk downloads. Not
 * awaited and never throws, so a slow or failing section cannot hold up or break the page; each
 * section shows its own loading and error state.
 */
export function prefetchDashboard(
  queryClient: QueryClient,
  api: ApiClient,
  search: DashboardSearch,
): void {
  void queryClient.prefetchQuery(
    candlesQuery(api, { ...NIFTY, range: search.range ?? DEFAULT_CHART_RANGE }),
  );
  void queryClient.prefetchQuery(indicesQuery(api));
  void queryClient.prefetchQuery(listQuery(api, resolveListId(search.list)));
}
