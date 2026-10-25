import type { TradingCommit } from '@nthstock/apiClient';
import type { Order, PositionsResponse } from '@nthstock/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { fundsKeys, ordersKeys, positionsKeys } from '@/shared/lib/queryKeys';

/**
 * Writes each trading-store commit through to the TanStack Query caches (SPEC-TFC-1 §10.1), so
 * pages that read REST queries (Portfolio, Orders, Funds) agree with the instrument page without
 * a refetch: funds, the positions list, the order book (T11) and any order detail that is cached.
 * The book is updated in place where it is cached: changed orders replace their rows and new ones
 * join at the top, newest first; it may hold earlier days the store does not.
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
  const changed = commit.reloaded ? state.orders : commit.orders;
  if (changed.length > 0) {
    queryClient.setQueryData<Order[]>(ordersKeys.book(), (book) =>
      book ? upsertOrders(book, changed) : book,
    );
  }
  for (const order of commit.orders) {
    // Only where a detail is already cached: the store holds today's orders, the detail any.
    queryClient.setQueryData<Order>(ordersKeys.detail(order.id), (cached) =>
      cached ? order : cached,
    );
  }
}

/** The book with `changed` applied: rows replaced in place, new orders first, newest first. */
function upsertOrders(book: readonly Order[], changed: readonly Order[]): Order[] {
  const byId = new Map(changed.map((order) => [order.id, order]));
  const next = book.map((order) => {
    const update = byId.get(order.id);
    if (!update) return order;
    byId.delete(order.id);
    return update;
  });
  const added = [...byId.values()].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  return added.length > 0 ? [...added, ...next] : next;
}
