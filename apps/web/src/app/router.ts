import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { NotFound, RouteError, RoutePending } from './layouts/RouteStates';

export type RouterContext = { queryClient: QueryClient };

/** Route defaults shared by the app and tests: every route gets an error boundary and a skeleton. */
export const routeDefaults = {
  defaultErrorComponent: RouteError,
  defaultPendingComponent: RoutePending,
  defaultNotFoundComponent: NotFound,
  defaultPendingMs: 150,
} as const;

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
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
