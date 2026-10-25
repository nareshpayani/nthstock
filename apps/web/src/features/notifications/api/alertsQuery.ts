import type { ApiClient } from '@nthstock/apiClient';
import { queryOptions } from '@tanstack/react-query';
import { alertsKeys, notificationsKeys } from '@/shared/lib/queryKeys';

/** `GET /v1/alerts`: active alerts first, then recently ended ones. */
export function priceAlertsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: alertsKeys.list(),
    queryFn: ({ signal }) => api.request('priceAlertsList', { signal }),
    staleTime: 10_000,
  });
}

/**
 * `GET /v1/notifications`: newest first, with the unread count for the bell. Not polled
 * (NSTOCK-0384): the socket pushes each new notification into this cache in both modes, and the
 * list is read again only after the socket reconnects (`useNotificationUpdates`).
 */
export function notificationsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: notificationsKeys.list(),
    queryFn: ({ signal }) => api.request('notificationsList', { signal }),
    staleTime: 10_000,
  });
}
