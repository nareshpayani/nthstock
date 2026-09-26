import { getMarketStatus } from '@nthstock/utils';
import { useContext, useEffect, useState } from 'react';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';

/** How often the open/closed state is re-read from the clock. */
export const MARKET_OPEN_REFRESH_MS = 30_000;

/**
 * True while NSE is in its continuous session (9:15–15:30 IST on a trading day, holidays
 * excluded), or when the mock market is forced open. Re-evaluated every 30 seconds.
 */
export function useMarketOpen(): boolean {
  const { clock, alwaysOpen } = useContext(MarketSessionContext);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (alwaysOpen) return undefined;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), MARKET_OPEN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [alwaysOpen]);
  return alwaysOpen || getMarketStatus(clock).state === 'open';
}
