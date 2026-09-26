import { createApiClient, type ApiClient } from '@nthstock/apiClient';
import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { NotFound, RouteError, RoutePending } from './layouts/RouteStates';

/** What every route's loader receives: the query cache and the REST client to prefetch with. */
export type RouterContext = { queryClient: QueryClient; apiClient: ApiClient };

/** Route defaults shared by the app and tests: every route gets an error boundary and a skeleton. */
export const routeDefaults = {
  defaultErrorComponent: RouteError,
  defaultPendingComponent: RoutePending,
  defaultNotFoundComponent: NotFound,
  defaultPendingMs: 150,
} as const;

export type AppRouterOptions = {
  queryClient: QueryClient;
  /** Defaults to a same-origin client; pass the one AppProviders gets so both share it. */
  apiClient?: ApiClient;
  history?: RouterHistory;
};

export function createAppRouter({
  queryClient,
  apiClient = createApiClient(),
  history,
}: AppRouterOptions) {
  return createRouter({
    routeTree,
    context: { queryClient, apiClient },
    defaultPreload: 'intent',
    // Loaders prefetch through TanStack Query, so the router itself never caches loader data.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    ...routeDefaults,
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
