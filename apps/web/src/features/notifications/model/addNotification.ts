import {
  NOTIFICATIONS_KEPT,
  type Notification,
  type NotificationsResponse,
} from '@nthstock/contracts';

/**
 * A pushed notification added to the cached centre (NSTOCK-0384): newest first, the unread count
 * bumped when it is unread, and only the newest `NOTIFICATIONS_KEPT` kept, as the server keeps
 * them (its unread count covers only those). Delivery is at least once, so an id the list already
 * holds leaves the list as it is: the same object comes back.
 */
export function addNotification(
  list: NotificationsResponse,
  notification: Notification,
): NotificationsResponse {
  if (list.items.some((item) => item.id === notification.id)) return list;
  const items = [notification, ...list.items].slice(0, NOTIFICATIONS_KEPT);
  const droppedUnread = list.items
    .slice(Math.max(0, items.length - 1))
    .filter((item) => !item.read).length;
  return {
    items,
    unread: Math.max(0, list.unread + (notification.read ? 0 : 1) - droppedUnread),
  };
}
