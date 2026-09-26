import type { MoverDirection } from '@nthstock/contracts';

export const strings = {
  title: 'Market movers',
  directionLabel: 'Gainers or losers',
  direction: { gainers: 'Top gainers', losers: 'Top losers' } satisfies Record<
    MoverDirection,
    string
  >,
  indexLabel: 'Index',
  /** Indices whose constituents are ranked, as the feed names them. */
  indices: [
    { value: 'NIFTY50', label: 'Nifty 50', name: 'NIFTY 50' },
    { value: 'NIFTYBANK', label: 'Bank', name: 'NIFTY BANK' },
    { value: 'NIFTYIT', label: 'IT', name: 'NIFTY IT' },
  ],
  loading: (direction: string, index: string) => `Loading ${direction.toLowerCase()} in ${index}`,
  empty: (direction: MoverDirection, index: string) => `No ${direction} in ${index} right now.`,
  errorTitle: 'Movers unavailable',
  errorBody: 'Market movers could not load.',
  retry: 'Retry',
} as const;
