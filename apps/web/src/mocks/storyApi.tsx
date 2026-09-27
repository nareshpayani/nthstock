import { createApiClient } from '@nthstock/apiClient';
import { ToastProvider } from '@nthstock/ui';
import { fixedClock, fromIst } from '@nthstock/utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiClientContext } from '@/shared/lib/apiClientContext';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';

/** A response body per path (e.g. `/v1/positions`), or a function of the request URL. */
export type StoryRoutes = Record<string, unknown | ((url: URL) => unknown)>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Providers for page stories on fixed, made-up data: a REST client that answers GET paths from
 * `routes` (404 for anything else, 200 `{}` echo for POSTs listed there), a query cache, toasts and
 * a market session fixed on Monday 28 Sep 2026, 11:00 IST. Nothing leaves the browser.
 */
export function StoryApiProviders({
  routes,
  children,
}: {
  routes: StoryRoutes;
  children: ReactNode;
}) {
  const [setup] = useState(() => ({
    api: createApiClient({
      baseUrl: 'http://story.test',
      fetch: (input) => {
        const url = new URL(input);
        const route = routes[url.pathname];
        if (route === undefined) {
          return Promise.resolve(json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
        }
        return Promise.resolve(json(typeof route === 'function' ? route(url) : route));
      },
    }),
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    }),
  }));
  return (
    <QueryClientProvider client={setup.queryClient}>
      <ApiClientContext.Provider value={setup.api}>
        <MarketSessionContext.Provider
          value={{ clock: fixedClock(fromIst(2026, 9, 28, 11 * 60)), alwaysOpen: false }}
        >
          <ToastProvider>
            <div className="bg-canvas p-4">{children}</div>
          </ToastProvider>
        </MarketSessionContext.Provider>
      </ApiClientContext.Provider>
    </QueryClientProvider>
  );
}
