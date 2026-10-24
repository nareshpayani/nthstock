import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';
import { alertsKeys, notificationsKeys } from '@/shared/lib/queryKeys';

/** How often the bell refetches without a socket push (api mode reads notifications over REST). */
export const NOTIFICATIONS_POLL_MS = 30_000;

/** `GET /v1/alerts`: active alerts first, then recently ended ones. */
export function priceAlertsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: alertsKeys.list(),
    queryFn: ({ signal }) => api.request('priceAlertsList', { signal }),
    staleTime: 10_000,
  });
}

/** `GET /v1/notifications`: newest first, with the unread count for the bell. */
export function notificationsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: notificationsKeys.list(),
    queryFn: ({ signal }) => api.request('notificationsList', { signal }),
    staleTime: 10_000,
    refetchInterval: NOTIFICATIONS_POLL_MS,
  });
}
