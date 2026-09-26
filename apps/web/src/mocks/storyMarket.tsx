import { createApiClient, createQuoteStore, type QuoteSource } from '@nthstock/apiClient';
import type { Quote } from '@nthstock/contracts';
import { MockMarketDataAdapter } from '@nthstock/marketData';
import { ToastProvider } from '@nthstock/ui';
import { fixedClock, fromIst } from '@nthstock/utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { getResponse } from 'msw';
import { useState, type ReactNode } from 'react';
import { ApiClientContext } from '@/shared/lib/apiClientContext';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { marketHandlers } from './handlers/market';

/** Saturday 26 Sep 2026, 11:30 IST: the mock market is closed, so the data holds still. */
export const STORY_CLOCK = fixedClock(fromIst(2026, 9, 26, 11 * 60 + 30));
const STORY_ORIGIN = 'http://story.test';

/**
 * The mock market in process, for Storybook and tests: REST through the real MSW market handlers
 * (msw's getResponse, no service worker) and a quote store that serves each subscribed symbol's
 * snapshot. The clock is fixed and the market closed, so every render shows the same numbers.
 */
export function createStoryMarket() {
  const adapter = new MockMarketDataAdapter({ clock: STORY_CLOCK });
  const handlers = marketHandlers(adapter);
  const apiClient = createApiClient({
    baseUrl: STORY_ORIGIN,
    fetch: async (url, init) =>
      (await getResponse(handlers, new Request(url, init))) ?? new Response(null, { status: 404 }),
  });
  const listeners = new Set<(quotes: readonly Quote[]) => void>();
  const source: QuoteSource = {
    subscribe(symbol, exchange) {
      void adapter.getQuote(symbol, exchange).then((quote) => {
        if (quote) for (const listener of listeners) listener([quote]);
      });
      return () => undefined;
    },
    onQuotes(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { adapter, apiClient, quoteStore: createQuoteStore({ source }) };
}

export type StoryProvidersProps = {
  /** Show LIVE badges as if NSE were open. */
  marketOpen?: boolean;
  children: ReactNode;
};

/**
 * Providers for feature stories: query cache, in-process mock API, quotes, market session and a
 * memory router (so row links render). Each story gets a fresh market and cache.
 */
export function StoryProviders({ marketOpen = false, children }: StoryProvidersProps) {
  const [setup] = useState(() => {
    const market = createStoryMarket();
    const root = createRootRoute({ component: () => children });
    const stock = createRoute({ getParentRoute: () => root, path: '/stocks/$symbol' });
    const login = createRoute({ getParentRoute: () => root, path: '/login' });
    const router = createRouter({
      routeTree: root.addChildren([stock, login]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    return { market, router, queryClient };
  });
  return (
    <QueryClientProvider client={setup.queryClient}>
      <ApiClientContext.Provider value={setup.market.apiClient}>
        <QuoteStoreContext.Provider value={setup.market.quoteStore}>
          <MarketSessionContext.Provider value={{ clock: STORY_CLOCK, alwaysOpen: marketOpen }}>
            {/* A story router, not the app's registered router type. */}
            <ToastProvider>
              <RouterProvider router={setup.router as never} />
            </ToastProvider>
          </MarketSessionContext.Provider>
        </QuoteStoreContext.Provider>
      </ApiClientContext.Provider>
    </QueryClientProvider>
  );
}
