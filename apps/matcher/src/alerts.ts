import {
  NOTIFICATION_EVENT_VERSION,
  NOTIFICATIONS_KEPT,
  notifyChannel,
  type Exchange,
  type NotificationEvent,
  type PriceAlert,
  type PriceAlertCondition,
} from '@nthstock/contracts';
import { priceAlertNotice, type BookAlert, type OrderBook } from '@nthstock/paperEngine';
import { shardOf } from '@nthstock/utils';
import type { Pool, PoolClient } from 'pg';
import type { FiredAlerts, MatcherLog } from './matcher.js';

/** An ACTIVE price alert as Postgres holds it, with its instrument. */
export type ActiveBookAlert = BookAlert & { token: number };

export type AlertStore = {
  /** Every ACTIVE alert (all shards: the table has no shard column, and it is small). */
  active(): Promise<ActiveBookAlert[]>;
  /**
   * Stores the alert as TRIGGERED at `ltp`, with its notification and outbox row, in one
   * transaction. Null when it is no longer ACTIVE: apps/api fired or the user cancelled it first.
   */
  fire(alertId: string, ltp: number, at: Date): Promise<NotificationEvent | null>;
  /** Drops the outbox row of a notification that was published, so the relay does not resend it. */
  published(notificationId: string): Promise<void>;
};

type AlertRow = {
  id: string;
  user_id: string;
  token: number;
  symbol: string;
  exchange: string;
  condition: string;
  price: string;
  note: string | null;
  status: string;
  created_at: Date;
  created_ltp: string;
  triggered_at: Date | null;
  triggered_ltp: string | null;
};

type NotificationRow = { id: string; created_at: Date };

function toAlert(row: AlertRow): PriceAlert {
  return {
    id: row.id,
    token: row.token,
    symbol: row.symbol,
    // The table's CHECK constraints hold these to the contract's lists.
    exchange: row.exchange as Exchange,
    condition: row.condition as PriceAlertCondition,
    price: Number(row.price),
    note: row.note,
    status: 'TRIGGERED',
    createdAt: row.created_at.toISOString(),
    createdLtp: Number(row.created_ltp),
    triggeredAt: row.triggered_at?.toISOString() ?? null,
    triggeredLtp: row.triggered_ltp === null ? null : Number(row.triggered_ltp),
  };
}

async function inTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    // Releasing with the error discards the connection, so a dead one is not reused.
    client.release(failure);
  }
}

/**
 * The price alerts the matcher fires (NSTOCK-0383), in the tables apps/api writes. `fire` is the
 * same transaction as apps/api's alerts store: an `UPDATE … WHERE status = 'ACTIVE' RETURNING`
 * that only one firing can win, then the notification, its outbox row, and the trim to the newest
 * `NOTIFICATIONS_KEPT`. So an alert both processes see cross fires once.
 */
export function createPgAlertStore(pool: Pick<Pool, 'connect' | 'query'>): AlertStore {
  return {
    async active() {
      const { rows } = await pool.query<{
        id: string;
        user_id: string;
        token: number;
        condition: PriceAlertCondition;
        price: string;
      }>(`SELECT id, user_id, token, condition, price FROM price_alerts WHERE status = 'ACTIVE'`);
      return rows.map((row) => ({
        alertId: row.id,
        userId: row.user_id,
        token: row.token,
        condition: row.condition,
        price: Number(row.price),
      }));
    },

    fire: (alertId, ltp, at) =>
      inTransaction(pool, async (client) => {
        const fired = await client.query<AlertRow>(
          `UPDATE price_alerts SET status = 'TRIGGERED', triggered_at = $2, triggered_ltp = $3
            WHERE id = $1 AND status = 'ACTIVE'
            RETURNING *`,
          [alertId, at, ltp],
        );
        const row = fired.rows[0];
        if (!row) return null;
        const alert = toAlert(row);
        const { title, body } = priceAlertNotice(alert, ltp);
        const stored = await client.query<NotificationRow>(
          `INSERT INTO notifications (user_id, kind, ref_id, title, body, symbol, exchange, created_at)
           VALUES ($1, 'PRICE_ALERT', $2, $3, $4, $5, $6, $7)
           RETURNING id, created_at`,
          [row.user_id, alert.id, title, body, alert.symbol, alert.exchange, at],
        );
        const notification = stored.rows[0];
        if (!notification) throw new Error('the alert notification was not stored');
        await client.query(
          `INSERT INTO notification_outbox (user_id, notification_id, created_at) VALUES ($1, $2, $3)`,
          [row.user_id, notification.id, at],
        );
        await client.query(
          `DELETE FROM notifications
            WHERE user_id = $1
              AND id < (SELECT id FROM notifications WHERE user_id = $1
                         ORDER BY id DESC OFFSET $2 LIMIT 1)`,
          [row.user_id, NOTIFICATIONS_KEPT - 1],
        );
        return {
          v: NOTIFICATION_EVENT_VERSION,
          userId: row.user_id,
          notification: {
            id: String(notification.id),
            kind: 'PRICE_ALERT',
            title,
            body,
            symbol: alert.symbol,
            exchange: alert.exchange,
            at: notification.created_at.toISOString(),
            read: false,
          },
          alert,
        } satisfies NotificationEvent;
      }),

    async published(notificationId) {
      await pool.query('DELETE FROM notification_outbox WHERE notification_id = $1', [
        notificationId,
      ]);
    },
  };
}

/** Where a fired alert's notification is published (the realtime server's notify channel). */
export type AlertPublisher = { publish(channel: string, message: string): Promise<unknown> };

/** How often the matcher reloads the active alerts, like the order reconcile (spec §5.3). */
export const ALERT_RELOAD_MS = 60_000;

export type AlertDesk = {
  /** The `onAlerts` callback for `startMatcher`. */
  onAlerts(fired: FiredAlerts): void;
  /** Resolves after the first load. */
  ready(): Promise<void>;
  /** Loads the active alerts now; resolves with how many were added to and taken off the books. */
  reload(): Promise<{ added: number; removed: number } | null>;
  /** Resolves when every firing in flight has settled (tests, shutdown). */
  settled(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Puts the shard's ACTIVE alerts on the matcher's books and stores the ones a tick fires
 * (NSTOCK-0383). On start and every `everyMs` it loads the active alerts: missing ones are added
 * (repairing a lost `ALERT_ADD`) and ones Postgres no longer has ACTIVE are taken off, but only
 * those that were on the book before the read, so an `ALERT_ADD` that arrived meanwhile stays.
 *
 * A fired alert is stored through `store.fire`, then its notification is published on the user's
 * notify channel and its outbox row dropped. If publishing fails, apps/api's relay sends it from
 * the outbox. If storing fails, the alert is put back on its book so the next crossing tick
 * retries; a lease change in between is covered by the next reload.
 */
export function startAlertDesk(options: {
  store: AlertStore;
  publisher: AlertPublisher;
  shard: number;
  shards: number;
  books: ReadonlyMap<number, OrderBook>;
  book: (token: number) => OrderBook;
  log: MatcherLog;
  everyMs?: number;
  /** Tests pass `null` to reload by hand. */
  timer?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval } | null;
  now?: () => Date;
}): AlertDesk {
  const { store, publisher, shard, shards, books, book, log } = options;
  const now = options.now ?? (() => new Date());
  const inFlight = new Set<Promise<void>>();
  let failing = false;
  let stopped = false;

  async function reload() {
    try {
      const before = new Map<string, OrderBook>();
      for (const held of books.values())
        for (const alert of held.alerts()) before.set(alert.alertId, held);
      const active = await store.active();
      if (stopped) return null;
      let added = 0;
      let removed = 0;
      const live = new Set<string>();
      for (const { token, ...alert } of active) {
        if (shardOf(token, shards) !== shard) continue;
        live.add(alert.alertId);
        if (book(token).addAlert(alert)) added += 1;
      }
      for (const [alertId, held] of before) {
        if (!live.has(alertId) && held.removeAlert(alertId)) removed += 1;
      }
      if (failing) log.info('Alert reload recovered', { shard });
      failing = false;
      return { added, removed };
    } catch (error) {
      if (!failing) {
        log.warn('Alert reload failed; retrying on the next round', {
          shard,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      failing = true;
      return null;
    }
  }

  async function fire(token: number, alert: BookAlert, ltp: number) {
    let event: NotificationEvent | null;
    try {
      event = await store.fire(alert.alertId, ltp, now());
    } catch (error) {
      log.warn('Alert could not be stored; it stays on the book', {
        alertId: alert.alertId,
        userId: alert.userId,
        error: error instanceof Error ? error.name : 'Error',
      });
      if (!stopped) book(token).addAlert(alert);
      return;
    }
    if (!event) return;
    try {
      await publisher.publish(notifyChannel(event.userId), JSON.stringify(event));
      await store.published(event.notification.id);
    } catch (error) {
      // Stored with its outbox row: apps/api's relay publishes it within a few seconds.
      log.warn('Alert notification not published; the outbox relay will send it', {
        alertId: alert.alertId,
        notificationId: event.notification.id,
        error: error instanceof Error ? error.name : 'Error',
      });
    }
  }

  const first = reload();
  const timer = options.timer === undefined ? globalThis : options.timer;
  const interval = timer?.setInterval(() => void reload(), options.everyMs ?? ALERT_RELOAD_MS);

  return {
    onAlerts(fired) {
      for (const alert of fired.alerts) {
        const firing = fire(fired.token, alert, fired.ltp);
        inFlight.add(firing);
        void firing.finally(() => inFlight.delete(firing));
      }
    },
    ready: () => first.then(() => undefined),
    reload,
    settled: async () => {
      while (inFlight.size > 0) await Promise.all(inFlight);
    },
    async stop() {
      stopped = true;
      if (interval !== undefined) timer?.clearInterval(interval);
      await first;
      while (inFlight.size > 0) await Promise.all(inFlight);
    },
  };
}
