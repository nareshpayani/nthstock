import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { instant, sqlList } from './columns.js';
import { users } from './users.js';

/**
 * `Exchange` from packages/contracts, repeated because drizzle-kit cannot load the contracts
 * package (ESM only); `db/schemaEnums.test.ts` keeps the two equal.
 */
export const EXCHANGES = ['NSE', 'BSE'] as const;

/**
 * A user's watchlists (T-197, spec backend-core §4.2), one row per list with its display
 * position. Names are unique per user ignoring case. `(user_id, position)` is also unique, as a
 * DEFERRABLE INITIALLY DEFERRED constraint added by a hand-written migration (Drizzle cannot
 * express one), so a reorder can move positions through each other in one transaction.
 *
 * The 10-list limit stays in the service; `PgWatchlistsRepo.update` holds it under concurrency by
 * locking the user row first.
 */
export const watchlists = pgTable(
  'watchlists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: smallint('position').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('watchlists_user_id_name_idx').on(table.userId, sql`lower(${table.name})`),
    check('watchlists_position_check', sql`${table.position} >= 0`),
  ],
);

/**
 * The stocks in a list (T-197), one row per stock with its display position. Symbol, exchange and
 * name are copied from the symbol master on add. `(watchlist_id, position)` is unique as a
 * DEFERRABLE INITIALLY DEFERRED constraint (hand-written migration), like the lists'.
 */
export const watchlistItems = pgTable(
  'watchlist_items',
  {
    watchlistId: text('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    token: integer('token').notNull(),
    symbol: text('symbol').notNull(),
    exchange: text('exchange').notNull(),
    name: text('name').notNull(),
    position: smallint('position').notNull(),
    addedAt: instant('added_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'watchlist_items_pkey', columns: [table.watchlistId, table.token] }),
    check('watchlist_items_exchange_check', sql`${table.exchange} IN (${sqlList(EXCHANGES)})`),
    check('watchlist_items_position_check', sql`${table.position} >= 0`),
  ],
);
