import type { ApiClient } from '@nthstock/apiClient';
import type { QueryClient } from '@tanstack/react-query';
import { DEFAULT_CHART_RANGE, NIFTY, candlesQuery } from '@/features/charts';
import { listQuery, resolveListId } from '@/features/collections';
import { indicesQuery } from '@/features/indices';
import {
  DEFAULT_MOVERS_DIRECTION,
  MOVERS_ROWS,
  moversQuery,
  resolveMoversIndex,
} from '@/features/movers';
import { instrumentQuery } from '@/features/stockDetail';
import { DEFAULT_HOME_CHART_SYMBOL, type DashboardSearch } from './dashboardSearch';

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
  const stock = search.stock ?? DEFAULT_HOME_CHART_SYMBOL;
  const charted = stock === 'NIFTY50' ? NIFTY : { symbol: stock, exchange: 'NSE' as const };
  if (stock !== 'NIFTY50') void queryClient.prefetchQuery(instrumentQuery(api, charted));
  void queryClient.prefetchQuery(
    candlesQuery(api, {
      ...charted,
      range: search.range ?? DEFAULT_CHART_RANGE,
      interval: search.interval,
    }),
  );
  void queryClient.prefetchQuery(indicesQuery(api));
  void queryClient.prefetchQuery(listQuery(api, resolveListId(search.list)));
  void queryClient.prefetchQuery(
    moversQuery(api, {
      index: resolveMoversIndex(search.moversIndex).value,
      direction: search.movers ?? DEFAULT_MOVERS_DIRECTION,
      limit: MOVERS_ROWS,
    }),
  );
}
