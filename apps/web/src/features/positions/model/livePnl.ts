import type { QuoteStore } from '@nthstock/apiClient';
import type { Position } from '@nthstock/contracts';
import { averagePrice, positionValues, type PositionBook } from '@nthstock/paperEngine';

/**
 * Live position P&L (T-148): the paper engine's own P&L math (`positionValues` from
 * packages/paperEngine) applied to the latest LTP in the quote store, so a position row moves on
 * every tick without a refetch, and matches what the server computes at the same price.
 */

/** One position at a live price. Money in paise. */
export type LivePosition = {
  key: string;
  position: Position;
  ltp: number;
  /** Weighted average cost of the open quantity. */
  avgPrice: number;
  realisedPnl: number;
  unrealisedPnl: number;
  /** Realised plus unrealised: the day's P&L of an intraday or today's delivery position. */
  pnl: number;
};

export type LivePositionsTotals = { realisedPnl: number; unrealisedPnl: number; pnl: number };

export type LivePositions = { rows: readonly LivePosition[]; totals: LivePositionsTotals };

/** A position is one instrument and product. */
export const positionKey = (position: Pick<Position, 'exchange' | 'symbol' | 'product'>) =>
  `${position.exchange}:${position.symbol}:${position.product}`;

/**
 * The engine's position book behind a `Position` snapshot. The open quantity's exact cost is
 * recovered from the unrealised P&L at the snapshot's LTP (long: qty × LTP − P&L; short:
 * qty × LTP + P&L), so no paise are lost to an average price.
 */
export function positionBook(position: Position): PositionBook {
  const open = Math.abs(position.netQty);
  const marketValue = open * position.ltp;
  const openCost =
    position.netQty > 0
      ? marketValue - position.unrealisedPnl
      : position.netQty < 0
        ? marketValue + position.unrealisedPnl
        : 0;
  return {
    netQty: position.netQty,
    openCost,
    buyQty: position.buyQty,
    sellQty: position.sellQty,
    buyValue: position.buyQty * position.avgBuyPrice,
    sellValue: position.sellQty * position.avgSellPrice,
    realisedPnl: position.realisedPnl,
  };
}

/** A position valued at `ltp` (paise); without a live price, at its snapshot LTP. */
export function livePosition(position: Position, ltp: number | undefined): LivePosition {
  const book = positionBook(position);
  const price = ltp !== undefined && ltp > 0 ? ltp : position.ltp;
  const values = price > 0 ? positionValues(book, price) : null;
  const unrealised = values?.unrealisedPnl ?? position.unrealisedPnl;
  return {
    key: positionKey(position),
    position,
    ltp: price,
    avgPrice: averagePrice(book),
    realisedPnl: position.realisedPnl,
    unrealisedPnl: unrealised,
    pnl: position.realisedPnl + unrealised,
  };
}

type Cached = { position: Position; ltp: number; live: LivePosition };

/**
 * A memoized selector over positions and live prices. A row is recomputed only when its own
 * position or its instrument's LTP changed; every other row keeps its object, and the result
 * keeps its object while no row changed. So a tick in one symbol changes only the P&L of that
 * symbol's positions, and components reading other rows do not re-render.
 */
export function createLivePositionsSelector() {
  const cache = new Map<string, Cached>();
  let last: LivePositions | null = null;
  let lastInput: readonly Position[] | null = null;

  return (positions: readonly Position[], ltpOf: (position: Position) => number | undefined) => {
    const rows: LivePosition[] = [];
    let changed = positions !== lastInput || last === null;
    const seen = new Set<string>();
    for (const position of positions) {
      const key = positionKey(position);
      seen.add(key);
      const live = ltpOf(position);
      const price = live !== undefined && live > 0 ? live : position.ltp;
      const cached = cache.get(key);
      if (cached && cached.position === position && cached.ltp === price) {
        rows.push(cached.live);
        continue;
      }
      const next = livePosition(position, price);
      cache.set(key, { position, ltp: price, live: next });
      rows.push(next);
      changed = true;
    }
    for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key);
    lastInput = positions;
    if (!changed && last) return last;
    const totals: LivePositionsTotals = { realisedPnl: 0, unrealisedPnl: 0, pnl: 0 };
    for (const row of rows) {
      totals.realisedPnl += row.realisedPnl;
      totals.unrealisedPnl += row.unrealisedPnl;
      totals.pnl += row.pnl;
    }
    last = { rows, totals };
    return last;
  };
}

/** The LTP of a position's instrument in the quote store, if a quote has arrived. */
export const storeLtp = (store: QuoteStore) => (position: Position) =>
  store.get(position.symbol, position.exchange)?.quote.ltp;
