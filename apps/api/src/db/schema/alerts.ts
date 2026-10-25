import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { instant, sqlList } from './columns.js';
import { users } from './users.js';
import { EXCHANGES } from './watchlists.js';

/** `PriceAlertCondition` and `PriceAlertStatus` from packages/contracts (see `schemaEnums.test.ts`). */
export const PRICE_ALERT_CONDITIONS = ['ABOVE', 'BELOW'] as const;
export const PRICE_ALERT_STATUSES = ['ACTIVE', 'TRIGGERED', 'CANCELLED'] as const;

/**
 * Price alerts (NSTOCK-0344, stored since NSTOCK-0383). An alert leaves ACTIVE once: firing is an
 * `UPDATE … WHERE status = 'ACTIVE'`, so of an API process and a matcher racing on one tick only
 * one stores it as TRIGGERED and writes its notification. Prices are paise.
 */
export const priceAlerts = pgTable(
  'price_alerts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: integer('token').notNull(),
    symbol: text('symbol').notNull(),
    exchange: text('exchange').notNull(),
    condition: text('condition').notNull(),
    price: bigint('price', { mode: 'number' }).notNull(),
    note: text('note'),
    status: text('status').notNull(),
    createdAt: instant('created_at').notNull(),
    createdLtp: bigint('created_ltp', { mode: 'number' }).notNull(),
    triggeredAt: instant('triggered_at'),
    triggeredLtp: bigint('triggered_ltp', { mode: 'number' }),
  },
  (table) => [
    index('price_alerts_user_id_created_at_idx').on(table.userId, table.createdAt.desc()),
    index('price_alerts_active_token_idx')
      .on(table.token)
      .where(sql`${table.status} = 'ACTIVE'`),
    check(
      'price_alerts_condition_check',
      sql`${table.condition} IN (${sqlList(PRICE_ALERT_CONDITIONS)})`,
    ),
    check('price_alerts_status_check', sql`${table.status} IN (${sqlList(PRICE_ALERT_STATUSES)})`),
    check('price_alerts_exchange_check', sql`${table.exchange} IN (${sqlList(EXCHANGES)})`),
    check('price_alerts_price_check', sql`${table.price} > 0 AND ${table.createdLtp} >= 0`),
  ],
);
