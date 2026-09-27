import type { Holding } from '@nthstock/contracts';

/** The holdings table's sortable columns (T-151), each a numeric field of `Holding` or the symbol. */
export const HOLDINGS_SORT_KEYS = [
  'symbol',
  'qty',
  'avgPrice',
  'ltp',
  'currentValue',
  'pnl',
  'pnlBp',
] as const;
export type HoldingsSortKey = (typeof HOLDINGS_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

export type HoldingsSort = { key: HoldingsSortKey; dir: SortDirection };

/** A–Z by symbol, as the server lists them. */
export const DEFAULT_HOLDINGS_SORT: HoldingsSort = { key: 'symbol', dir: 'asc' };

/**
 * Holdings in column order: numbers compare as integer paise (or basis points), ties fall back to
 * the symbol A–Z, so the order is stable whatever the direction. Returns a new array.
 */
export function sortHoldings(rows: readonly Holding[], { key, dir }: HoldingsSort): Holding[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary =
      key === 'symbol' ? a.symbol.localeCompare(b.symbol) : (a[key] as number) - (b[key] as number);
    return primary !== 0 ? sign * primary : a.symbol.localeCompare(b.symbol);
  });
}

/**
 * The sort after clicking a column header: the same column flips its direction; a new column
 * starts high to low for numbers (biggest P&L first) and A–Z for the symbol.
 */
export function nextHoldingsSort(current: HoldingsSort, key: HoldingsSortKey): HoldingsSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'symbol' ? 'asc' : 'desc' };
}
