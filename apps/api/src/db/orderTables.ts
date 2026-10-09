import {
  bigint,
  bigserial,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
} from 'drizzle-orm/pg-core';
import { instant } from './schema/columns.js';

/**
 * `orders` and `order_events`, partitioned by IST `trade_date` (T-201, migration 0011). Drizzle
 * cannot express PARTITION BY, so the tables live in a hand-written migration and are declared here
 * for typed queries only: this file is outside `db/schema`, so drizzle-kit and `db:check` never see
 * it. Keep the columns equal to the migration.
 */
const paise = (name: string) => bigint(name, { mode: 'number' });

export const orders = pgTable(
  'orders',
  {
    id: text('id').notNull(),
    tradeDate: date('trade_date', { mode: 'string' }).notNull(),
    userId: text('user_id').notNull(),
    clientOrderId: text('client_order_id'),
    token: integer('token').notNull(),
    symbol: text('symbol').notNull(),
    exchange: text('exchange').notNull(),
    side: text('side').notNull(),
    type: text('type').notNull(),
    product: text('product').notNull(),
    qty: integer('qty').notNull(),
    price: paise('price'),
    filledQty: integer('filled_qty').notNull(),
    avgFillPrice: paise('avg_fill_price'),
    status: text('status').notNull(),
    statusReason: text('status_reason'),
    rejectCode: text('reject_code'),
    placedAt: instant('placed_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [index('orders_user_id_placed_at_idx').on(table.userId, table.placedAt)],
);

export const orderEvents = pgTable('order_events', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  tradeDate: date('trade_date', { mode: 'string' }).notNull(),
  orderId: text('order_id').notNull(),
  userId: text('user_id').notNull(),
  seq: smallint('seq').notNull(),
  event: text('event').notNull(),
  status: text('status').notNull(),
  at: instant('at').notNull(),
  qty: integer('qty').notNull(),
  type: text('type').notNull(),
  price: paise('price'),
  fillPrice: paise('fill_price'),
  note: text('note'),
});
