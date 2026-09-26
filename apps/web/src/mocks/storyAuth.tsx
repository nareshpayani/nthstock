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
import { createSessionApiClient } from '@/shared/lib/sessionClient';
import { ApiClientContext } from '@/shared/lib/apiClientContext';
import { authHandlers } from './handlers/auth';

const STORY_ORIGIN = 'http://story-auth.test';

/**
 * Providers for login stories: the real MSW auth handlers in process (no service worker), a query
 * cache and a memory router with /login and /dashboard, so the steps can call the API and follow
 * links. The dev OTP 123456 works; every story gets a fresh auth backend.
 */
export function StoryAuthProviders({ children }: { children: ReactNode }) {
  const [setup] = useState(() => {
    const handlers = authHandlers();
    const apiClient = createSessionApiClient({
      baseUrl: STORY_ORIGIN,
      fetch: async (url, init) =>
        (await getResponse(handlers, new Request(url, init))) ??
        new Response(null, { status: 404 }),
    });
    const root = createRootRoute({ component: () => children });
    const login = createRoute({ getParentRoute: () => root, path: '/login' });
    const dashboard = createRoute({ getParentRoute: () => root, path: '/dashboard' });
    const router = createRouter({
      routeTree: root.addChildren([login, dashboard]),
      history: createMemoryHistory({ initialEntries: ['/login'] }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { apiClient, router, queryClient };
  });
  return (
    <QueryClientProvider client={setup.queryClient}>
      <ApiClientContext.Provider value={setup.apiClient}>
        {/* A story router, not the app's registered router type. */}
        <RouterProvider router={setup.router as never} />
      </ApiClientContext.Provider>
    </QueryClientProvider>
  );
}
