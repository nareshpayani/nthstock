import type { WsNotification } from '@nthstock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSession } from '@/shared/hooks/useSession';
import { useOrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { alertsKeys, notificationsKeys } from '@/shared/lib/queryKeys';

/**
 * Live notifications (NSTOCK-0344): while signed in, every `notification` message refreshes the
 * bell and the alerts list, then calls `onNotification`.
 */
export function useNotificationUpdates(onNotification: (message: WsNotification) => void): void {
  const source = useOrderUpdateSource();
  const queryClient = useQueryClient();
  const { status } = useSession();
  const latest = useRef(onNotification);
  useEffect(() => {
    latest.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (status !== 'authenticated' || !source.onNotification) return undefined;
    source.connect();
    return source.onNotification((message) => {
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      if (message.alert) void queryClient.invalidateQueries({ queryKey: alertsKeys.all });
      latest.current(message);
    });
  }, [status, source, queryClient]);
}
