import { createTradingStore, type TradingStore } from '@nthstock/apiClient';
import { createContext, useContext } from 'react';

/**
 * A store that is never started: it stays empty and idle. Used when no provider is mounted
 * (component tests, Storybook) and in api mode, where apps/api has no account frames yet.
 */
const detachedStore = createTradingStore({ loadState: () => new Promise(() => undefined) });

export const TradingStoreContext = createContext<TradingStore>(detachedStore);

/** The app's trading store (ADR 0012). Provided once by AppProviders. */
export function useTradingStore(): TradingStore {
  return useContext(TradingStoreContext);
}
