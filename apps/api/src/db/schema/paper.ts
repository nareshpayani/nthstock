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
    /** The engine's sequence number of its last order or trailing-stop change (ADR 0012). */
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
    /**
     * Today's and live orders the engine placed to close a position (trailing-stop exits and
     * `closePosition`): reduce-only and never refused for cash, so the flag must survive a reload.
     */
    exitOrderIds: text('exit_order_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    syncedTo: instant('synced_to').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    check('paper_accounts_opening_balance_check', sql`${table.openingBalance} >= 0`),
    check('paper_accounts_version_check', sql`${table.version} >= 0`),
    check('paper_accounts_seq_check', sql`${table.seq} >= 0`),
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

/**
 * `TrailingStopStatus`, the trail units and the exit types from packages/contracts (repeated for
 * drizzle-kit like `LEDGER_ENTRY_TYPES`; `db/schemaEnums.test.ts` keeps them equal).
 */
export const TRAILING_STOP_STATUSES = [
  'PENDING_ENTRY',
  'ARMED',
  'TRAILING',
  'TRIGGERED',
  'EXECUTED',
  'CANCELLED',
  'REJECTED',
] as const;
export const TRAIL_UNITS = ['AMOUNT', 'PERCENT'] as const;
export const TRAILING_STOP_EXIT_TYPES = ['MARKET', 'LIMIT'] as const;

/**
 * Trailing stops (NSTOCK-0368, SPEC-TFC-1 §6): the `TrailingStop` contract, one row per stop.
 * The engine owns every field; the store upserts the stops a change touched. `entry_order_id` and
 * `exit_order_id` point into the partitioned `orders` table, so they have no foreign key.
 * `client_request_id` is the place request's idempotency key.
 */
export const trailingStops = pgTable(
  'trailing_stops',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: integer('token').notNull(),
    symbol: text('symbol').notNull(),
    exchange: text('exchange').notNull(),
    product: text('product').notNull(),
    direction: text('direction').notNull(),
    trailUnit: text('trail_unit').notNull(),
    /** Set for an AMOUNT trail. */
    trailAmount: paise('trail_amount'),
    /** Set for a PERCENT trail. */
    trailBasisPoints: integer('trail_basis_points'),
    activationPrice: paise('activation_price'),
    exitOrderType: text('exit_order_type').notNull(),
    exitLimitOffset: paise('exit_limit_offset'),
    status: text('status').notNull(),
    statusReason: text('status_reason'),
    watermarkPrice: paise('watermark_price'),
    stopPrice: paise('stop_price'),
    protectedQty: integer('protected_qty').notNull(),
    entryOrderId: text('entry_order_id'),
    exitOrderId: text('exit_order_id'),
    clientRequestId: text('client_request_id'),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    // `load` reads a user's active stops and today's finished ones.
    index('trailing_stops_user_id_updated_at_idx').on(table.userId, table.updatedAt),
    // `liveAccountIds` at boot: the users with an active stop, a small part of the table.
    index('trailing_stops_active_user_id_idx')
      .on(table.userId)
      .where(sql`${table.status} IN ('PENDING_ENTRY', 'ARMED', 'TRAILING', 'TRIGGERED')`),
    uniqueIndex('trailing_stops_user_id_client_request_id_key').on(
      table.userId,
      table.clientRequestId,
    ),
    check(
      'trailing_stops_status_check',
      sql`${table.status} IN (${sqlList(TRAILING_STOP_STATUSES)})`,
    ),
    check('trailing_stops_product_check', sql`${table.product} IN ('INTRADAY', 'DELIVERY')`),
    check('trailing_stops_exchange_check', sql`${table.exchange} IN ('NSE', 'BSE')`),
    check('trailing_stops_direction_check', sql`${table.direction} IN ('LONG', 'SHORT')`),
    check(
      'trailing_stops_trail_check',
      sql`(${table.trailUnit} = 'AMOUNT' AND ${table.trailAmount} > 0 AND ${table.trailBasisPoints} IS NULL) OR (${table.trailUnit} = 'PERCENT' AND ${table.trailBasisPoints} > 0 AND ${table.trailAmount} IS NULL)`,
    ),
    check(
      'trailing_stops_exit_check',
      sql`${table.exitOrderType} IN (${sqlList(TRAILING_STOP_EXIT_TYPES)})`,
    ),
    check('trailing_stops_qty_check', sql`${table.protectedQty} >= 0`),
    check(
      'trailing_stops_prices_check',
      sql`(${table.activationPrice} IS NULL OR ${table.activationPrice} > 0) AND (${table.stopPrice} IS NULL OR ${table.stopPrice} > 0) AND (${table.watermarkPrice} IS NULL OR ${table.watermarkPrice} >= 0) AND (${table.exitLimitOffset} IS NULL OR ${table.exitLimitOffset} >= 0)`,
    ),
    check('trailing_stops_seq_check', sql`${table.seq} >= 0`),
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
