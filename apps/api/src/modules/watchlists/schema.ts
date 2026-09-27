import type { Exchange } from '@nthstock/contracts';

/**
 * Stored shapes of the watchlists module. The request and response schemas live in
 * `packages/contracts` (`watchlist.ts`); these are the rows a Drizzle schema replaces in Phase 3
 * (ADR 0004 §3): one `watchlists` row per list (with its position) and one `watchlist_items` row
 * per stock (with its position).
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
