import type { WsNotification } from '@nthstock/contracts';
import { useToast } from '@nthstock/ui';
import { useCallback } from 'react';
import { useNotificationUpdates } from '../hooks/useNotificationUpdates';

/**
 * Mounted once in the app shell (NSTOCK-0344): keeps the bell current and toasts a fired price
 * alert the moment it fires, on any page. Fills and trailing stops have their own toasts and
 * announcements, so they only reach the bell.
 */
export function NotificationsBridge() {
  const toast = useToast();
  const onNotification = useCallback(
    ({ notification }: WsNotification) => {
      if (notification.kind !== 'PRICE_ALERT') return;
      toast.show({ title: notification.title, description: notification.body, tone: 'info' });
    },
    [toast],
  );
  useNotificationUpdates(onNotification);
  return null;
}
