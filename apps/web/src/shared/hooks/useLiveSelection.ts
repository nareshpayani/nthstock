import type { QuoteStore } from '@nthstock/apiClient';
import type { Exchange } from '@nthstock/contracts';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQuoteStore } from '@/shared/lib/quoteStoreContext';

export type LiveInstrument = { symbol: string; exchange: Exchange };

/**
 * Reads a value derived from several live quotes (T-148): subscribes every listed instrument in
 * the quote store (ref-counted, like `useQuote`), and re-reads `select` after each flush that
 * ticks one of them. `select` must return the same object while nothing it reads has changed
 * (a memoized selector), or React renders on every flush.
 */
export function useLiveSelection<T>(
  instruments: readonly LiveInstrument[],
  select: (store: QuoteStore) => T,
): T {
  const store = useQuoteStore();
  const keys = useMemo(() => {
    const unique = new Map<string, LiveInstrument>();
    for (const { symbol, exchange } of instruments) {
      unique.set(`${exchange}:${symbol}`, { symbol, exchange });
    }
    return [...unique.values()];
  }, [instruments]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const releases = keys.map(({ symbol, exchange }) =>
        store.subscribe(symbol, exchange, onChange),
      );
      return () => {
        for (const release of releases) release();
      };
    },
    [store, keys],
  );
  const snapshot = useCallback(() => select(store), [select, store]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
