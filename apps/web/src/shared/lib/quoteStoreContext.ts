import { createQuoteStore, type QuoteStore } from '@nthstock/apiClient';
import { createContext, useContext } from 'react';

/**
 * A store with no source: it never receives quotes. Used when no provider is mounted (component
 * tests, Storybook), so live cells render their loading state instead of throwing.
 */
const detachedStore = createQuoteStore();

export const QuoteStoreContext = createContext<QuoteStore>(detachedStore);

/** The app's quote store (ADR 0005 UI-03). Provided once by AppProviders. */
export function useQuoteStore(): QuoteStore {
  return useContext(QuoteStoreContext);
}
