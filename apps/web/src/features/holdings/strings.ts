import type { HoldingsSortKey } from './model/holdingsSort';

/** UI copy for Portfolio: the live summary and the holdings table (T-151 to T-153). */
export const strings = {
  title: 'Portfolio',
  description: 'Delivery holdings from your paper trades, valued live.',
  loading: 'Loading your holdings',
  loadError: {
    title: 'Your holdings could not load',
    body: 'Check your connection and try again.',
    retry: 'Retry',
  },
  empty: {
    title: 'Your portfolio is empty',
    body: 'Delivery buys move here after 3:30 PM IST. Find a stock in search or your watchlist to start.',
    cta: 'Search stocks',
  },
  summary: {
    label: 'Portfolio summary',
    invested: 'Invested',
    current: 'Current value',
    total: 'Total P&L',
    day: 'Day’s P&L',
  },
  tableLabel: 'Holdings',
  columns: {
    symbol: 'Stock',
    qty: 'Qty',
    avgPrice: 'Avg price',
    ltp: 'LTP',
    currentValue: 'Current value',
    pnl: 'P&L',
    pnlBp: 'P&L %',
  } satisfies Record<HoldingsSortKey, string>,
  sortBy: (column: string) => `Sort by ${column}`,
} as const;
