import type {
  Exchange,
  PriceAlert,
  PriceAlertCondition,
  PriceAlertStatus,
} from '@nthstock/contracts';
import { and, asc, count, desc, eq, ne } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { priceAlerts } from '../../db/schema/alerts.js';
import type { NotificationsRepo } from '../notifications/index.js';
import { ENDED_ALERTS_LISTED, type AlertsRepo } from './repo.js';

type AlertRow = typeof priceAlerts.$inferSelect;

function toAlert(row: AlertRow): PriceAlert {
  return {
    id: row.id,
    token: row.token,
    symbol: row.symbol,
    // The table's CHECK constraints hold these to the contract's lists.
    exchange: row.exchange as Exchange,
    condition: row.condition as PriceAlertCondition,
    price: row.price,
    note: row.note,
    status: row.status as PriceAlertStatus,
    createdAt: row.createdAt.toISOString(),
    createdLtp: row.createdLtp,
    triggeredAt: row.triggeredAt?.toISOString() ?? null,
    triggeredLtp: row.triggeredLtp,
  };
}

/**
 * Price alerts in Postgres (NSTOCK-0383). `fire` is one transaction: an `UPDATE … WHERE status =
 * 'ACTIVE' RETURNING` that only one firing can win, then the notification and its outbox row.
 */
export function createPgAlertsRepo({
  database,
  notifications,
}: {
  database: Database;
  notifications: NotificationsRepo;
}): AlertsRepo {
  const { db } = database;
  return {
    async list(userId) {
      const mine = eq(priceAlerts.userId, userId);
      const newest = desc(priceAlerts.createdAt);
      const active = await db
        .select()
        .from(priceAlerts)
        .where(and(mine, eq(priceAlerts.status, 'ACTIVE')))
        .orderBy(newest);
      const ended = await db
        .select()
        .from(priceAlerts)
        .where(and(mine, ne(priceAlerts.status, 'ACTIVE')))
        .orderBy(newest)
        .limit(ENDED_ALERTS_LISTED);
      return [...active, ...ended].map(toAlert);
    },

    async countActive(userId) {
      const [row] = await db
        .select({ n: count() })
        .from(priceAlerts)
        .where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.status, 'ACTIVE')));
      return row?.n ?? 0;
    },

    async insert(userId, alert) {
      await db.insert(priceAlerts).values({
        id: alert.id,
        userId,
        token: alert.token,
        symbol: alert.symbol,
        exchange: alert.exchange,
        condition: alert.condition,
        price: alert.price,
        note: alert.note,
        status: alert.status,
        createdAt: new Date(alert.createdAt),
        createdLtp: alert.createdLtp,
        triggeredAt: null,
        triggeredLtp: null,
      });
    },

    async cancel(userId, id) {
      const [row] = await db
        .update(priceAlerts)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(priceAlerts.id, id),
            eq(priceAlerts.userId, userId),
            eq(priceAlerts.status, 'ACTIVE'),
          ),
        )
        .returning();
      if (row) return toAlert(row);
      const [existing] = await db
        .select({ id: priceAlerts.id })
        .from(priceAlerts)
        .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)));
      return existing ? 'INVALID_STATE' : 'NOT_FOUND';
    },

    async active() {
      const rows = await db
        .select()
        .from(priceAlerts)
        .where(eq(priceAlerts.status, 'ACTIVE'))
        .orderBy(asc(priceAlerts.createdAt));
      return rows.map((row) => ({ userId: row.userId, alert: toAlert(row) }));
    },

    fire: (alertId, ltp, at, notification) =>
      database.transaction(async (tx) => {
        const [row] = await tx
          .update(priceAlerts)
          .set({ status: 'TRIGGERED', triggeredAt: at, triggeredLtp: ltp })
          .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.status, 'ACTIVE')))
          .returning();
        if (!row) return null;
        const alert = toAlert(row);
        const [stored] = await notifications.appendMany(
          [{ ...notification({ userId: row.userId, alert }), alert }],
          tx,
        );
        if (!stored) throw new Error('the alert notification was not stored');
        return { userId: row.userId, alert, stored };
      }),

    reset: () => Promise.reject(new Error('Truncate the Postgres tables as the owner instead')),
  };
}
