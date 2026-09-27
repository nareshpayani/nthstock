import type { QuoteStore } from '@nthstock/apiClient';
import type { Holding, PortfolioSummary, Quote } from '@nthstock/contracts';
import { basisPoints, holdingValues } from '@nthstock/paperEngine';

/**
 * Live holdings and portfolio totals (T-148): the paper engine's `holdingValues` at the latest
 * LTP in the quote store, against the previous close, so current value is qty × LTP in paise and
 * the summary always equals the sum of the rows.
 */

export type LiveQuotePrice = Pick<Quote, 'ltp' | 'prevClose'>;

export type LiveHoldingsTotals = Pick<
  PortfolioSummary,
  'investedValue' | 'currentValue' | 'totalPnl' | 'totalPnlBp' | 'dayPnl' | 'dayPnlBp'
>;

export type LiveHoldings = { rows: readonly Holding[]; totals: LiveHoldingsTotals };

export const holdingKey = (holding: Pick<Holding, 'exchange' | 'symbol'>) =>
  `${holding.exchange}:${holding.symbol}`;

/**
 * A holding valued at a live quote; without one, as the server valued it. The previous close
 * comes from the quote, or else from the snapshot itself (LTP − day's change per share).
 */
export function liveHolding(holding: Holding, quote: LiveQuotePrice | undefined): Holding {
  if (!quote || quote.ltp <= 0) return holding;
  const snapshotClose = holding.ltp - Math.round(holding.dayChange / holding.qty);
  const prevClose = quote.prevClose > 0 ? quote.prevClose : snapshotClose;
  const values = holdingValues(
    { qty: holding.qty, investedValue: holding.investedValue },
    quote.ltp,
    prevClose > 0 ? prevClose : quote.ltp,
  );
  return { ...holding, ...values };
}

/** Totals over holdings rows: exactly their sums, percentages in basis points. */
export function holdingsTotals(rows: readonly Holding[]): LiveHoldingsTotals {
  let investedValue = 0;
  let currentValue = 0;
  let dayPnl = 0;
  for (const row of rows) {
    investedValue += row.investedValue;
    currentValue += row.currentValue;
    dayPnl += row.dayChange;
  }
  const totalPnl = currentValue - investedValue;
  return {
    investedValue,
    currentValue,
    totalPnl,
    totalPnlBp: basisPoints(totalPnl, investedValue),
    dayPnl,
    dayPnlBp: basisPoints(dayPnl, currentValue - dayPnl),
  };
}

type Cached = { holding: Holding; ltp: number; prevClose: number; live: Holding };

/**
 * A memoized selector over holdings and live quotes: a row is recomputed only when its holding
 * or its quote's price changed, and the result keeps its object while no row changed.
 */
export function createLiveHoldingsSelector() {
  const cache = new Map<string, Cached>();
  let last: LiveHoldings | null = null;
  let lastInput: readonly Holding[] | null = null;

  return (
    holdings: readonly Holding[],
    quoteOf: (holding: Holding) => LiveQuotePrice | undefined,
  ) => {
    const rows: Holding[] = [];
    let changed = holdings !== lastInput || last === null;
    const seen = new Set<string>();
    for (const holding of holdings) {
      const key = holdingKey(holding);
      seen.add(key);
      const quote = quoteOf(holding);
      const ltp = quote?.ltp ?? 0;
      const prevClose = quote?.prevClose ?? 0;
      const cached = cache.get(key);
      if (
        cached &&
        cached.holding === holding &&
        cached.ltp === ltp &&
        cached.prevClose === prevClose
      ) {
        rows.push(cached.live);
        continue;
      }
      const live = liveHolding(holding, quote);
      cache.set(key, { holding, ltp, prevClose, live });
      rows.push(live);
      changed = true;
    }
    for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key);
    lastInput = holdings;
    if (!changed && last) return last;
    last = { rows, totals: holdingsTotals(rows) };
    return last;
  };
}

/** A holding's live quote in the quote store, if one has arrived. */
export const storeQuote = (store: QuoteStore) => (holding: Holding) =>
  store.get(holding.symbol, holding.exchange)?.quote;
