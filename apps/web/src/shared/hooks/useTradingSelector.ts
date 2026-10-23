import type { TradingState, TradingStore } from '@nthstock/apiClient';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

/**
 * `getSnapshot` for one selector: one selection per committed state, and the previous selection
 * while it is still equal, so a new but equal array does not re-render.
 */
function selection<T>(
  store: Pick<TradingStore, 'getState'>,
  selector: (state: TradingState) => T,
  isEqual: (a: T, b: T) => boolean,
): () => T {
  let last: { state: TradingState; value: T } | null = null;
  return () => {
    const state = store.getState();
    if (last?.state === state) return last.value;
    const value = selector(state);
    last = { state, value: last && isEqual(last.value, value) ? last.value : value };
    return last.value;
  };
}

/**
 * A slice of the trading store (ADR 0012): the component re-renders only when the slice changes,
 * at most once per committed frame. A selector that builds a new object or array each time needs
 * an `isEqual` (for example comparing ids and `seq`), or it re-renders on every commit.
 */
export function useTradingSelector<T>(
  selector: (state: TradingState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useTradingStore();
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const getSnapshot = useMemo(
    () => selection(store, selector, isEqual),
    [store, selector, isEqual],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
