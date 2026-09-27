import type { ApiClient, QuoteStore } from '@nthstock/apiClient';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProviders } from '@/app/providers/AppProviders';
import { createQueryClient } from '@/app/queryClient';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import type { OrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { offlineApiClient } from './renderApp';

export type RenderWithProvidersOptions = {
  apiClient?: ApiClient;
  quoteStore?: QuoteStore;
  marketSession?: MarketSession;
  orderUpdates?: OrderUpdateSource;
};

/**
 * Renders one component with the app's providers inside a two-route memory router: `/` shows the
 * component and `/stocks/$symbol` shows a "Stock <SYMBOL>" heading, so links can be followed.
 */
export function renderWithProviders(ui: ReactNode, options: RenderWithProvidersOptions = {}) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => ui });
  const stock = createRoute({
    getParentRoute: () => root,
    path: '/stocks/$symbol',
    component: function Stock() {
      const { symbol } = stock.useParams();
      return <h1>{`Stock ${symbol}`}</h1>;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([home, stock]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const view = render(
    <AppProviders
      queryClient={queryClient}
      apiClient={options.apiClient ?? offlineApiClient}
      {...(options.quoteStore ? { quoteStore: options.quoteStore } : {})}
      {...(options.marketSession ? { marketSession: options.marketSession } : {})}
      {...(options.orderUpdates ? { orderUpdates: options.orderUpdates } : {})}
    >
      {/* The test router is not the app's registered router type. */}
      <RouterProvider router={router as never} />
    </AppProviders>,
  );
  return { ...view, router, queryClient };
}
