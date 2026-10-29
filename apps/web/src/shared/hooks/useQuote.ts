import type { LiveQuote } from '@nthstock/apiClient';
import type { Exchange } from '@nthstock/contracts';
import { useCallback, useSyncExternalStore } from 'react';
import { useQuoteStore } from '@/shared/lib/quoteStoreContext';

/**
 * Live quote for one symbol (T-056). Thin React glue over the framework-agnostic quote store in
 * packages/apiClient: mounting subscribes the symbol (the store ref-counts it down to one WS
 * subscription), unmounting releases it, and only this component re-renders when it ticks.
 * `undefined` until the first quote arrives.
 */
export function useQuote(symbol: string, exchange: Exchange = 'NSE'): LiveQuote | undefined {
  const store = useQuoteStore();
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(symbol, exchange, onChange),
    [store, symbol, exchange],
  );
  const snapshot = useCallback(() => store.get(symbol, exchange), [store, symbol, exchange]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Whether a live quote for the symbol has arrived. Re-renders only when that flips, not on every
 * tick, so a parent can choose a state (CR-T18) without reading prices itself (ADR 0005).
 */
export function useHasQuote(symbol: string, exchange: Exchange = 'NSE'): boolean {
  const store = useQuoteStore();
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(symbol, exchange, onChange),
    [store, symbol, exchange],
  );
  const snapshot = useCallback(
    () => store.get(symbol, exchange) !== undefined,
    [store, symbol, exchange],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
