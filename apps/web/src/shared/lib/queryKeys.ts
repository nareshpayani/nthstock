/**
 * Query keys for the paper-trading server state that several features invalidate (ADR 0005:
 * `[feature, entity, params]`). They live in shared so that placing, modifying or cancelling an
 * order, an `orderUpdate` and a funds reset can invalidate each other's caches without features
 * importing each other (no funds ↔ orders cycle). Each feature's `api/*Query.ts` builds its
 * `queryOptions` on these keys.
 */

/** Paper funds. Placing an order, an order update and a reset invalidate `fundsKeys.all`. */
export const fundsKeys = {
  all: ['funds'] as const,
  summary: () => ['funds', 'summary'] as const,
  ledger: () => ['funds', 'ledger'] as const,
};

/**
 * The order book. Placing, modifying or cancelling an order, and every `orderUpdate`, invalidate
 * `ordersKeys.all`, so the book and any open order detail refetch.
 */
export const ordersKeys = {
  all: ['orders'] as const,
  book: () => ['orders', 'book'] as const,
  detail: (id: string) => ['orders', 'detail', { id }] as const,
  history: (id: string) => ['orders', 'history', { id }] as const,
};

/** Holdings and the portfolio summary. Every `orderUpdate` invalidates `holdingsKeys.all`. */
export const holdingsKeys = {
  all: ['holdings'] as const,
  list: () => ['holdings', 'list'] as const,
  summary: () => ['holdings', 'summary'] as const,
};

/** Positions. Every `orderUpdate` invalidates `positionsKeys.all`. */
export const positionsKeys = {
  all: ['positions'] as const,
  list: () => ['positions', 'list'] as const,
};
