import type { TradingCommit } from '@nthstock/apiClient';
import type { Order, PositionsResponse } from '@nthstock/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { fundsKeys, ordersKeys, positionsKeys } from '@/shared/lib/queryKeys';

/**
 * Writes each trading-store commit through to the TanStack Query caches (SPEC-TFC-1 §10.1), so
 * pages that read REST queries (Portfolio, Orders, Funds) agree with the instrument page without
 * a refetch: funds, the positions list and any order detail that is cached. The order book stays
 * on its `orderUpdate` invalidation until T11 moves it onto the store.
 */
export function writeTradingCommit(queryClient: QueryClient, commit: TradingCommit): void {
  const { state } = commit;
  if (state.status !== 'ready') return;
  if (commit.fundsChanged && state.funds) {
    queryClient.setQueryData(fundsKeys.summary(), state.funds);
  }
  if (commit.positionsChanged) {
    const positions: PositionsResponse = { items: [...state.positions] };
    queryClient.setQueryData(positionsKeys.list(), positions);
  }
  for (const order of commit.orders) {
    // Only where a detail is already cached: the store holds today's orders, the detail any.
    queryClient.setQueryData<Order>(ordersKeys.detail(order.id), (cached) =>
      cached ? order : cached,
    );
  }
}
