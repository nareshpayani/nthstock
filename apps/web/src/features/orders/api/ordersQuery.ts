import type { ApiClient } from '@nthstock/apiClient';
import { PAGE_LIMIT_MAX, type Order } from '@nthstock/contracts';
import { queryOptions } from '@tanstack/react-query';

import { ordersKeys } from '@/shared/lib/queryKeys';

/** Pages read at most per book load: 20 × 100 orders is far beyond a paper trading day. */
const MAX_PAGES = 20;

/**
 * `GET /v1/orders`, every page, newest first. One list feeds all three tabs, so each tab's count
 * is exactly the rows it shows (T-144).
 */
export function orderBookQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ordersKeys.book(),
    queryFn: async ({ signal }) => {
      const orders: Order[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await api.request('ordersList', {
          query: { limit: PAGE_LIMIT_MAX, ...(cursor ? { cursor } : {}) },
          signal,
        });
        orders.push(...result.items);
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }
      return orders;
    },
    staleTime: 5_000,
  });
}

/** `GET /v1/orders/:id`: one order, for the detail drawer (T-146). */
export function orderDetailQuery(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: ordersKeys.detail(id),
    queryFn: ({ signal }) => api.request('orderGet', { params: { id }, signal }),
    staleTime: 5_000,
  });
}

/** `GET /v1/orders/:id/history`: the status timeline (T-146). */
export function orderHistoryQuery(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: ordersKeys.history(id),
    queryFn: ({ signal }) => api.request('orderHistory', { params: { id }, signal }),
    staleTime: 5_000,
  });
}
