import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { AppProviders } from '@/app/providers/AppProviders';
import { createQueryClient } from '@/app/queryClient';
import { createAppRouter } from '@/app/router';

/** Renders the real app (providers + file routes) at a URL, for route and shell tests. */
export function renderApp(url: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [url] }));
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router };
}
