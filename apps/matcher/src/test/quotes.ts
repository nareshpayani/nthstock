import type { Quote } from '@nthstock/contracts';

/** Monday 28 Sep 2026, 10:30 IST: the market is open. */
const OPEN_TS = '2026-09-28T05:00:00.000Z';
/** Sunday 27 Sep 2026: the market is closed. */
export const CLOSED_TS = '2026-09-27T05:00:00.000Z';

export const quote = (token: number, ltp: number, ts = OPEN_TS): Quote => ({
  token,
  symbol: `SYM${String(token)}`,
  exchange: 'NSE',
  ltp,
  change: 0,
  changeBp: 0,
  open: ltp,
  high: ltp,
  low: ltp,
  prevClose: ltp,
  volume: 1,
  ts,
});
