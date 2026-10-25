import {
  NOTIFICATIONS_KEPT,
  type Notification,
  type NotificationsResponse,
} from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import type { Tx } from '../../db/client.js';
import type { NewNotification, StoredNotification } from './schema.js';

/**
 * Storage for the notification centre and its outbox (spec market-data-and-matching §6,
 * NSTOCK-0379). `appendMany` writes each notification with an outbox row and trims the user's
 * notifications to the newest `NOTIFICATIONS_KEPT` (a trimmed notification's outbox row goes with
 * it). On Postgres, passing `tx` writes them in the caller's transaction, so they commit or roll
 * back with the change that raised them.
 */
export interface NotificationsRepo {
  appendMany(entries: readonly NewNotification[], tx?: Tx): Promise<StoredNotification[]>;
  /** The user's notifications, newest first, with the unread count. */
  list(userId: string): Promise<NotificationsResponse>;
  /** Marks the given notifications read, or all of the user's when `ids` is left out. */
  markRead(userId: string, ids?: readonly string[]): Promise<NotificationsResponse>;
  /** Outbox rows written before `before`, oldest first, as the notifications they carry. */
  pendingOutbox(before: Date, limit: number): Promise<StoredNotification[]>;
  /** Drops the outbox rows of these notifications, once published. */
  clearOutbox(notificationIds: readonly string[]): Promise<void>;
  /** Outbox rows left (tests and the relay's log). */
  outboxSize(): Promise<number>;
  /** Tests only: forget everything. */
  reset(): Promise<void>;
}

type Row = { userId: string; notification: Notification; outboxAt: Date | null };

const responseOf = (items: Notification[]): NotificationsResponse => ({
  items,
  unread: items.filter((item) => !item.read).length,
});

/** The memory repo: the same rules over arrays, for unit tests and `DB_DRIVER=memory`. */
export function createMemoryNotificationsRepo({ clock }: { clock: Clock }): NotificationsRepo {
  let nextId = 1;
  /** Per user, newest first. */
  const byUser = new Map<string, Row[]>();
  const rowsOf = (userId: string) => byUser.get(userId) ?? [];
  const list = (userId: string) => responseOf(rowsOf(userId).map((row) => row.notification));

  return {
    appendMany(entries) {
      const at = clock.now();
      const stored = entries.map((entry): StoredNotification => {
        const notification: Notification = {
          id: String(nextId++),
          kind: entry.kind,
          title: entry.title,
          body: entry.body,
          symbol: entry.symbol,
          exchange: entry.exchange,
          at: at.toISOString(),
          read: false,
        };
        const rows = [
          { userId: entry.userId, notification, outboxAt: at },
          ...rowsOf(entry.userId),
        ];
        byUser.set(entry.userId, rows.slice(0, NOTIFICATIONS_KEPT));
        return {
          userId: entry.userId,
          notification,
          ...(entry.alert ? { alert: entry.alert } : {}),
        };
      });
      return Promise.resolve(stored);
    },
    list: (userId) => Promise.resolve(list(userId)),
    markRead(userId, ids) {
      const wanted = ids ? new Set(ids) : null;
      for (const row of rowsOf(userId)) {
        if (!wanted || wanted.has(row.notification.id)) {
          row.notification = { ...row.notification, read: true };
        }
      }
      return Promise.resolve(list(userId));
    },
    pendingOutbox(before, limit) {
      const pending = [...byUser.values()]
        .flat()
        .filter((row) => row.outboxAt !== null && row.outboxAt < before)
        .sort((a, b) => Number(a.notification.id) - Number(b.notification.id))
        .slice(0, limit);
      return Promise.resolve(
        pending.map((row) => ({ userId: row.userId, notification: row.notification })),
      );
    },
    clearOutbox(notificationIds) {
      const ids = new Set(notificationIds);
      for (const rows of byUser.values()) {
        for (const row of rows) if (ids.has(row.notification.id)) row.outboxAt = null;
      }
      return Promise.resolve();
    },
    outboxSize: () =>
      Promise.resolve([...byUser.values()].flat().filter((row) => row.outboxAt !== null).length),
    reset() {
      byUser.clear();
      return Promise.resolve();
    },
  };
}
