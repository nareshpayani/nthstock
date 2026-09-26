import type { Exchange } from '@nthstock/contracts';

export type HeaderIndex = { symbol: string; exchange: Exchange; name: string };

/** The two indices in the top bar, as the mock (and later vendor) feed names them. */
export const headerIndices: readonly HeaderIndex[] = [
  { symbol: 'NIFTY50', exchange: 'NSE', name: 'NIFTY 50' },
  { symbol: 'SENSEX', exchange: 'BSE', name: 'SENSEX' },
];
