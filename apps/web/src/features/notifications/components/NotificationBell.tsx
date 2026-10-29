import type { PriceAlert } from '@nthstock/contracts';
import {
  Button,
  ErrorState,
  IconBell,
  IconButton,
  Sheet,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSession } from '@/shared/hooks/useSession';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { notificationsQuery, priceAlertsQuery } from '../api/alertsQuery';
import { useCancelAlert, useMarkNotificationsRead } from '../hooks/useAlertMutations';
import { strings } from '../strings';
import { AlertList } from './AlertList';
import { NotificationList } from './NotificationList';

/**
 * The bell in the header (NSTOCK-0344), signed in only: the unread count as a badge, and a side
 * sheet with the notification centre and every price alert. Opening the centre marks everything
 * read; the badge stays until the server agrees.
 */
export function NotificationBell() {
  const { status } = useSession();
  if (status !== 'authenticated') return null;
  return <SignedInBell />;
}

function SignedInBell() {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('notifications');
  const notifications = useQuery(notificationsQuery(api));
  const alerts = useQuery({ ...priceAlertsQuery(api), enabled: open });
  const markRead = useMarkNotificationsRead();
  const cancel = useCancelAlert();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const unread = notifications.data?.unread ?? 0;

  const change = (next: boolean) => {
    setOpen(next);
    if (next && unread > 0) markRead.mutate(undefined);
  };
  const remove = (alert: PriceAlert) => {
    setRemoving((ids) => new Set(ids).add(alert.id));
    cancel.mutate(alert.id, {
      onSettled: () =>
        setRemoving((ids) => {
          const next = new Set(ids);
          next.delete(alert.id);
          return next;
        }),
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      title={strings.centre.title}
      description={strings.centre.description}
      trigger={
        <IconButton
          label={unread > 0 ? strings.bell.labelUnread(unread) : strings.bell.label}
          className="relative"
          icon={
            <>
              <IconBell />
              {unread > 0 ? (
                <span
                  aria-hidden="true"
                  data-testid="notification-badge"
                  className="pointer-events-none absolute top-0.5 right-0.5 isolate flex h-4 min-w-4 items-center justify-center rounded-pill bg-down px-1 text-[10px] leading-none font-semibold text-surface"
                >
                  {/* A ring pings out of the badge while anything is unread (NSTOCK-0462).
                      The -z-10 ring sits behind the text only because the badge is `isolate`. */}
                  <span
                    data-part="ripple"
                    className="absolute inset-0 -z-10 animate-ripple rounded-pill bg-down opacity-0 motion-reduce:hidden"
                  />
                  {strings.bell.badge(unread)}
                </span>
              ) : null}
            </>
          }
        />
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="grid gap-2 px-4 pb-4">
        <TabsList aria-label={strings.centre.tabsLabel}>
          <TabsTrigger value="notifications">{strings.centre.tabs.notifications}</TabsTrigger>
          <TabsTrigger value="alerts">{strings.centre.tabs.alerts}</TabsTrigger>
        </TabsList>
        <TabsContent value="notifications">
          {notifications.isError && !notifications.data ? (
            <ErrorState
              title={strings.centre.loadError}
              retryLabel={strings.centre.retry}
              onRetry={() => void notifications.refetch()}
            />
          ) : (
            <NotificationList
              items={notifications.data?.items ?? []}
              onNavigate={() => setOpen(false)}
            />
          )}
          {notifications.data?.items.some((n) => !n.read) ? (
            <Button variant="secondary" size="sm" onClick={() => markRead.mutate(undefined)}>
              {strings.centre.markAllRead}
            </Button>
          ) : null}
        </TabsContent>
        <TabsContent value="alerts">
          <AlertList items={alerts.data?.items ?? []} onRemove={remove} removing={removing} />
        </TabsContent>
      </Tabs>
    </Sheet>
  );
}
