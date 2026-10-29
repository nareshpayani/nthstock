import type { Exchange } from '@nthstock/contracts';

export type HeaderIndex = { symbol: string; exchange: Exchange; name: string };

/** The two indices in the top bar, as the mock (and later vendor) feed names them. */
export const headerIndices: readonly HeaderIndex[] = [
  { symbol: 'NIFTY50', exchange: 'NSE', name: 'NIFTY 50' },
  { symbol: 'SENSEX', exchange: 'BSE', name: 'SENSEX' },
];

/** The phone's status strip shows every index (A21), and drifts to bring the rest into view. */
export const stripIndices: readonly HeaderIndex[] = [
  ...headerIndices,
  { symbol: 'NIFTYBANK', exchange: 'NSE', name: 'NIFTY BANK' },
  { symbol: 'NIFTYIT', exchange: 'NSE', name: 'NIFTY IT' },
  { symbol: 'NIFTYMIDCAP100', exchange: 'NSE', name: 'NIFTY MIDCAP 100' },
];
