export const strings = {
  title: 'Stocks lists',
  /** The curated lists the API serves, in tab order (ids from GET /v1/market/lists). */
  lists: [
    { id: 'market-giants', title: 'Market Giants' },
    { id: 'best-returns', title: 'Best Returns' },
    { id: 'highest-dividends', title: 'Highest Dividends' },
    { id: 'top-it', title: 'Top IT' },
  ],
  loading: (title: string) => `Loading ${title}`,
  empty: 'No stocks in this list right now.',
  errorTitle: 'List unavailable',
  errorBody: 'This list could not load.',
  retry: 'Retry',
} as const;
