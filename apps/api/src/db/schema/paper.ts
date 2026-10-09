import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { instant, sqlList } from './columns.js';
import { users } from './users.js';

/**
 * `LedgerEntryType` and the product values from packages/contracts, repeated because drizzle-kit
 * cannot load the contracts package (ESM only); `db/schemaEnums.test.ts` keeps them equal.
 */
export const LEDGER_ENTRY_TYPES = [
  'OPENING_CREDIT',
  'ORDER_BLOCK',
  'ORDER_RELEASE',
  'TRADE_DEBIT',
  'TRADE_CREDIT',
  'RESET',
] as const;

/** Money is integer paise: `bigint` read as a JS number (paise stay below 2^53). */
const paise = (name: string) => bigint(name, { mode: 'number' });

/**
 * One paper account per user (T-200, spec backend-core §4.3). `version` is the optimistic
 * concurrency counter the engine bumps on every write (`WHERE version = expected`); `synced_to` is
 * the instant the stored state was last brought up to.
 */
export const paperAccounts = pgTable(
  'paper_accounts',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    openingBalance: paise('opening_balance').notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(0),
    syncedTo: instant('synced_to').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    check('paper_accounts_opening_balance_check', sql`${table.openingBalance} >= 0`),
    check('paper_accounts_version_check', sql`${table.version} >= 0`),
  ],
);

/**
 * The funds ledger, append-only for the app role (a hand-written migration revokes UPDATE and
 * DELETE; the purge role may still DELETE a purged user's rows). `seq` is the per-user sequence,
 * gap-free, assigned by the repo inside the account transaction. `order_id` points into the
 * partitioned `orders` table, so it has no foreign key.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    amount: paise('amount').notNull(),
    balanceAfter: paise('balance_after').notNull(),
    orderId: text('order_id'),
    description: text('description').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('ledger_entries_user_id_seq_key').on(table.userId, table.seq),
    index('ledger_entries_user_id_seq_desc_idx').on(table.userId, sql`${table.seq} DESC`),
    check('ledger_entries_seq_check', sql`${table.seq} >= 1`),
    check('ledger_entries_type_check', sql`${table.type} IN (${sqlList(LEDGER_ENTRY_TYPES)})`),
  ],
);

/**
 * Today's per-product position books (T-200): the `PositionBook` of packages/paperEngine, one row
 * per user, IST trading day, instrument and product.
 */
export const positions = pgTable(
  'positions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tradeDate: date('trade_date', { mode: 'string' }).notNull(),
    token: integer('token').notNull(),
    product: text('product').notNull(),
    symbol: text('symbol').notNull(),
    exchange: text('exchange').notNull(),
    netQty: integer('net_qty').notNull(),
    openCost: paise('open_cost').notNull(),
    buyQty: integer('buy_qty').notNull(),
    sellQty: integer('sell_qty').notNull(),
    buyValue: paise('buy_value').notNull(),
    sellValue: paise('sell_value').notNull(),
    realisedPnl: paise('realised_pnl').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'positions_pkey',
      columns: [table.userId, table.tradeDate, table.token, table.product],
    }),
    check('positions_product_check', sql`${table.product} IN ('INTRADAY', 'DELIVERY')`),
    check('positions_exchange_check', sql`${table.exchange} IN ('NSE', 'BSE')`),
    check('positions_qty_check', sql`${table.buyQty} >= 0 AND ${table.sellQty} >= 0`),
  ],
);

/** Delivery holdings (T-200): quantity and the cost it was bought for. */
export const holdings = pgTable(
  'holdings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: integer('token').notNull(),
    qty: integer('qty').notNull(),
    investedValue: paise('invested_value').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'holdings_pkey', columns: [table.userId, table.token] }),
    check('holdings_qty_check', sql`${table.qty} > 0`),
    check('holdings_invested_value_check', sql`${table.investedValue} >= 0`),
  ],
);

/** What a day's sales of a holding brought in and earned (T-200). */
export const holdingSales = pgTable(
  'holding_sales',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tradeDate: date('trade_date', { mode: 'string' }).notNull(),
    token: integer('token').notNull(),
    qty: integer('qty').notNull(),
    proceeds: paise('proceeds').notNull(),
    realisedPnl: paise('realised_pnl').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'holding_sales_pkey',
      columns: [table.userId, table.tradeDate, table.token],
    }),
    check('holding_sales_qty_check', sql`${table.qty} > 0`),
  ],
);

/** The end-of-day portfolio figures behind the P&L history (T-200). */
export const pnlSnapshots = pgTable(
  'pnl_snapshots',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tradeDate: date('trade_date', { mode: 'string' }).notNull(),
    invested: paise('invested').notNull(),
    currentValue: paise('current_value').notNull(),
    dayPnl: paise('day_pnl').notNull(),
    realisedPnl: paise('realised_pnl').notNull(),
    totalPnl: paise('total_pnl').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [primaryKey({ name: 'pnl_snapshots_pkey', columns: [table.userId, table.tradeDate] })],
);
