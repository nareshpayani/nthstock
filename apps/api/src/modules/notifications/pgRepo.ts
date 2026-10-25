import {
  NOTIFICATIONS_KEPT,
  type Exchange,
  type Notification,
  type NotificationKind,
} from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { and, asc, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../db/client.js';
import { notificationOutbox, notifications } from '../../db/schema/notifications.js';
import type { NotificationsRepo } from './repo.js';
import type { StoredNotification } from './schema.js';

type NotificationRow = typeof notifications.$inferSelect;

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id.toString(),
    // The table's CHECK constraints hold these to the contract's lists.
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    symbol: row.symbol,
    exchange: row.exchange as Exchange | null,
    at: row.createdAt.toISOString(),
    read: row.readAt !== null,
  };
}

/** Ids that are not bigint literals can name no row; dropping them keeps the cast from throwing. */
const rowIds = (ids: readonly string[]) => ids.filter((id) => /^\d{1,18}$/.test(id)).map(BigInt);

/**
 * Notifications and their outbox in Postgres (NSTOCK-0379). `appendMany` is three statements in
 * the caller's transaction (or one of its own): the multi-row INSERT, the outbox rows, and a trim
 * of each user's rows past the newest `NOTIFICATIONS_KEPT`, which cascades to their outbox rows.
 * Reads go through `notifications_user_id_id_idx`.
 */
export function createPgNotificationsRepo({
  database,
  clock,
}: {
  database: Database;
  clock: Clock;
}): NotificationsRepo {
  async function list(userId: string) {
    const rows = await database.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.id))
      .limit(NOTIFICATIONS_KEPT);
    const items = rows.map(toNotification);
    return { items, unread: items.filter((item) => !item.read).length };
  }

  async function write(tx: Tx, entries: Parameters<NotificationsRepo['appendMany']>[0]) {
    const createdAt = clock.now();
    const rows = await tx
      .insert(notifications)
      .values(
        entries.map((entry) => ({
          userId: entry.userId,
          kind: entry.kind,
          refId: entry.refId,
          title: entry.title,
          body: entry.body,
          symbol: entry.symbol,
          exchange: entry.exchange,
          createdAt,
        })),
      )
      .returning();
    const sorted = rows.toSorted((a, b) => (a.id < b.id ? -1 : 1));
    await tx
      .insert(notificationOutbox)
      .values(sorted.map((row) => ({ userId: row.userId, notificationId: row.id, createdAt })));
    // In user id order, so two writers trimming the same users cannot deadlock.
    for (const userId of [...new Set(sorted.map((row) => row.userId))].sort()) {
      // The newest NOTIFICATIONS_KEPT stay; the index walks them, so this reads at most that many.
      await tx.execute(sql`
        DELETE FROM ${notifications}
        WHERE ${notifications.userId} = ${userId}
          AND ${notifications.id} < (
            SELECT ${notifications.id} FROM ${notifications}
            WHERE ${notifications.userId} = ${userId}
            ORDER BY ${notifications.id} DESC
            OFFSET ${NOTIFICATIONS_KEPT - 1} LIMIT 1
          )`);
    }
    return sorted.map((row, index): StoredNotification => {
      // The bigserial ids are drawn in VALUES order, so the rows sorted by id line up with the entries.
      const alert = entries[index]?.alert;
      return { userId: row.userId, notification: toNotification(row), ...(alert ? { alert } : {}) };
    });
  }

  return {
    async appendMany(entries, tx) {
      if (entries.length === 0) return [];
      return tx ? write(tx, entries) : database.transaction((own) => write(own, entries));
    },

    list,

    async markRead(userId, ids) {
      const scope = and(eq(notifications.userId, userId), isNull(notifications.readAt));
      await database.db
        .update(notifications)
        .set({ readAt: clock.now() })
        .where(ids ? and(scope, inArray(notifications.id, rowIds(ids))) : scope);
      return list(userId);
    },

    async pendingOutbox(before, limit) {
      const rows = await database.db
        .select({ notification: notifications })
        .from(notificationOutbox)
        .innerJoin(notifications, eq(notifications.id, notificationOutbox.notificationId))
        .where(lt(notificationOutbox.createdAt, before))
        .orderBy(asc(notificationOutbox.id))
        .limit(limit);
      return rows.map(({ notification }) => ({
        userId: notification.userId,
        notification: toNotification(notification),
      }));
    },

    async clearOutbox(notificationIds) {
      const ids = rowIds(notificationIds);
      if (ids.length === 0) return;
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.notificationId, ids));
    },

    async outboxSize() {
      const [row] = await database.db.select({ n: count() }).from(notificationOutbox);
      return row?.n ?? 0;
    },

    reset: () => Promise.reject(new Error('Truncate the Postgres tables as the owner instead')),
  };
}
