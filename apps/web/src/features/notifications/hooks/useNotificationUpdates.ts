import {
  NOTIFICATIONS_KEPT,
  type NotificationsResponse,
  type WsNotification,
} from '@nthstock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSession } from '@/shared/hooks/useSession';
import { useOrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { alertsKeys, notificationsKeys } from '@/shared/lib/queryKeys';
import { addNotification } from '../model/addNotification';

/**
 * Live notifications (NSTOCK-0344, NSTOCK-0384): while signed in, every `notification` message is
 * added to the cached centre (no poll), a fired alert refreshes the alerts list, and
 * `onNotification` is called. Delivery is at least once, so an id already seen or already in the
 * centre is dropped: it shows once and toasts once. After the socket reconnects, both lists are
 * read again, since messages sent during the gap are lost.
 */
export function useNotificationUpdates(onNotification: (message: WsNotification) => void): void {
  const source = useOrderUpdateSource();
  const queryClient = useQueryClient();
  const { status } = useSession();
  const latest = useRef(onNotification);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    latest.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (status !== 'authenticated') {
      seen.current.clear();
      return undefined;
    }
    if (!source.onNotification) return undefined;
    source.connect();
    const stopNotifications = source.onNotification((message) => {
      const { notification } = message;
      const key = notificationsKeys.list();
      const cached = queryClient.getQueryData<NotificationsResponse>(key);
      if (seen.current.has(notification.id)) return;
      if (cached?.items.some((item) => item.id === notification.id)) return;
      remember(seen.current, notification.id);
      if (cached) queryClient.setQueryData(key, addNotification(cached, notification));
      else void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      if (message.alert) void queryClient.invalidateQueries({ queryKey: alertsKeys.all });
      latest.current(message);
    });
    const stopReconnect = source.onReconnect?.(() => {
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      void queryClient.invalidateQueries({ queryKey: alertsKeys.all });
    });
    return () => {
      stopNotifications();
      stopReconnect?.();
    };
  }, [status, source, queryClient]);
}

/** Keeps the newest `NOTIFICATIONS_KEPT` ids, oldest dropped first (a Set keeps insertion order). */
function remember(ids: Set<string>, id: string): void {
  ids.add(id);
  if (ids.size > NOTIFICATIONS_KEPT) {
    const oldest = ids.values().next();
    if (!oldest.done) ids.delete(oldest.value);
  }
}
