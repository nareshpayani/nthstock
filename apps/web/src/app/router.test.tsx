import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/renderApp';
import { routeDefaults } from './router';

describe('file routes (T-022)', () => {
  it.each([
    ['/dashboard', /^Good (morning|afternoon|evening)$/],
    ['/portfolio', 'Portfolio'],
    ['/positions', 'Positions'],
    ['/orders', 'Orders'],
    ['/funds', 'Funds'],
    ['/stocks/infy', 'INFY'],
    ['/login', 'Log in to nthstock'],
    ['/no-such-page', 'Page not found'],
  ])('%s renders its page', async (url, heading) => {
    renderApp(url);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('redirects / to /dashboard', async () => {
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});

describe('route error boundary (T-023)', () => {
  it('renders ErrorState with a retry instead of a blank page when a route throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = createRootRoute({ component: Outlet });
    const broken = createRoute({
      getParentRoute: () => root,
      path: '/broken',
      component: () => {
        throw new Error('boom');
      },
    });
    const router = createRouter({
      routeTree: root.addChildren([broken]),
      history: createMemoryHistory({ initialEntries: ['/broken'] }),
      ...routeDefaults,
    });
    render(<RouterProvider router={router} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This page could not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
