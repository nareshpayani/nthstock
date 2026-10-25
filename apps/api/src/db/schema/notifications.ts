import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { instant, sqlList } from './columns.js';
import { users } from './users.js';
import { EXCHANGES } from './watchlists.js';

/**
 * `NotificationKind` from packages/contracts, repeated because drizzle-kit cannot load the
 * contracts package; `db/schemaEnums.test.ts` keeps the two equal.
 */
export const NOTIFICATION_KINDS = [
  'PRICE_ALERT',
  'ORDER_FILLED',
  'TRAILING_STOP',
  'ORDER_REJECTED',
  'AMO_RELEASED',
  'SQUARED_OFF',
  'SECURITY',
] as const;

/**
 * The notification centre (spec market-data-and-matching §6.1, NSTOCK-0379). A row is written in
 * the same transaction as its cause (a fill, a stop, a login), so it exists exactly when its event
 * does. `ref_id` names what raised it (an order, a trailing stop, an alert, a session). Bodies are
 * built from contract types and never hold a mobile number or a name. The newest
 * `NOTIFICATIONS_KEPT` per user are kept; older rows are trimmed on write.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    refId: text('ref_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    symbol: text('symbol'),
    exchange: text('exchange'),
    createdAt: instant('created_at').notNull(),
    readAt: instant('read_at'),
  },
  (table) => [
    index('notifications_user_id_id_idx').on(table.userId, table.id.desc()),
    check('notifications_kind_check', sql`${table.kind} IN (${sqlList(NOTIFICATION_KINDS)})`),
    check(
      'notifications_exchange_check',
      sql`${table.exchange} IS NULL OR ${table.exchange} IN (${sqlList(EXCHANGES)})`,
    ),
  ],
);

/**
 * Notifications committed but not yet published (§6.2). Written with the notification; the writer
 * deletes the row once it has published on `notifyChannel(userId)`, and the relay publishes and
 * deletes rows a crash left behind. Delivery is therefore at least once.
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notificationId: bigint('notification_id', { mode: 'bigint' })
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [index('notification_outbox_created_at_idx').on(table.createdAt)],
);
