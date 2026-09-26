import { createApiClient, type ApiClient, type QuoteStore } from '@nthstock/apiClient';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { AppProviders } from '@/app/providers/AppProviders';
import { createQueryClient } from '@/app/queryClient';
import { createAppRouter } from '@/app/router';
import type { MarketSession } from '@/shared/lib/marketSessionContext';

/** A client with no network: every call fails at once as a network error (no MSW server needed). */
export const offlineApiClient: ApiClient = createApiClient({
  baseUrl: 'http://offline.test',
  fetch: () => Promise.reject(new TypeError('offline')),
});

export type RenderAppOptions = {
  quoteStore?: QuoteStore;
  /** Defaults to offlineApiClient; pass a client on the MSW node server for data. */
  apiClient?: ApiClient;
  marketSession?: MarketSession;
};

/** Renders the real app (providers + file routes) at a URL, for route and shell tests. */
export function renderApp(url: string, options: RenderAppOptions = {}) {
  const queryClient = createQueryClient();
  // Fail fast in tests: no retry delay left running after a test ends.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const apiClient = options.apiClient ?? offlineApiClient;
  const router = createAppRouter({
    queryClient,
    apiClient,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const view = render(
    <AppProviders
      queryClient={queryClient}
      apiClient={apiClient}
      {...(options.quoteStore ? { quoteStore: options.quoteStore } : {})}
      {...(options.marketSession ? { marketSession: options.marketSession } : {})}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, queryClient };
}
