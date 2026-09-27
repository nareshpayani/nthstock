import type { ProductType } from '@nthstock/contracts';

/** UI copy for positions (T-149, T-150, T-153). Paper trading only: no real money moves. */
export const strings = {
  title: 'Positions',
  description:
    'Today’s paper positions with live P&L. Delivery buys move to Portfolio after 3:30 PM IST.',
  loading: 'Loading your positions',
  loadError: {
    title: 'Your positions could not load',
    body: 'Check your connection and try again.',
    retry: 'Retry',
  },
  empty: {
    title: 'No positions today',
    body: 'Buy or sell a stock and it shows here with live P&L. Find one in search or your watchlist.',
    cta: 'Search stocks',
  },
  tableLabel: 'Positions',
  columns: {
    product: 'Product',
    stock: 'Stock',
    qty: 'Net qty',
    avg: 'Avg price',
    ltp: 'LTP',
    pnl: 'P&L',
    actions: 'Actions',
  },
  products: { DELIVERY: 'Delivery', INTRADAY: 'Intraday' } satisfies Record<ProductType, string>,
  closed: 'Closed',
  noAverage: '–',
  exit: 'Exit',
  exitLabel: (symbol: string, product: string) => `Exit ${symbol} ${product} position`,
  total: {
    label: 'Total P&L',
    realised: 'Realised',
    unrealised: 'Unrealised',
    note: 'Realised plus unrealised, live',
  },
} as const;
