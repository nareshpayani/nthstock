import type { Exchange } from '@nthstock/contracts';
import { useEffect } from 'react';
import { useQuoteStore } from '@/shared/lib/quoteStoreContext';

/**
 * Keeps `symbols` subscribed while the tab is hidden (T-077). The active watchlist calls this, so
 * its prices stay live in a background tab while every other symbol is unsubscribed. Pins are
 * ref-counted in the quote store and released on unmount or when the list changes.
 */
export function useKeepLive(symbols: readonly string[], exchange: Exchange = 'NSE'): void {
  const store = useQuoteStore();
  const list = symbols.join(',');
  useEffect(() => {
    const releases = list
      .split(',')
      .filter(Boolean)
      .map((symbol) => store.pin(symbol, exchange));
    return () => {
      for (const release of releases) release();
    };
  }, [store, list, exchange]);
}
