import type { Exchange } from '@nthstock/contracts';

/**
 * Stored shapes of the watchlists module. The request and response schemas live in
 * `packages/contracts` (`watchlist.ts`). In Postgres (`db/schema/watchlists.ts`, T-197) a list is
 * one `watchlists` row (with its position) and each stock one `watchlist_items` row (with its
 * position); `PgWatchlistsRepo` maps them to these records.
 */

/** One stock in a list. Symbol, exchange and name are copied from the symbol master on add. */
export type WatchlistItemRecord = {
  token: number;
  symbol: string;
  exchange: Exchange;
  name: string;
  addedAt: Date;
};

/** One named list; `items` is in display order. */
export type WatchlistRecord = {
  id: string;
  userId: string;
  name: string;
  items: WatchlistItemRecord[];
  createdAt: Date;
  updatedAt: Date;
};
