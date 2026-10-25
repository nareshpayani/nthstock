import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteError, RoutePending } from './RouteStates';

describe('RouteError', () => {
  it('Try again resets the boundary and reloads the route', async () => {
    const reset = vi.fn();
    const root = createRootRoute({
      component: () => <RouteError error={new Error('x')} reset={reset} />,
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const invalidate = vi.spyOn(router, 'invalidate');
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalled();
  });

  it('reloads the page when the route code is from an older deploy', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    window.sessionStorage.clear();
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://nthstock-a13a5.web.app/assets/dashboard-ul55Qa07.js',
    );
    const reset = vi.fn();
    const root = createRootRoute({
      component: () => <RouteError error={error} reset={reset} />,
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(<RouterProvider router={router} />);
    await screen.findByRole('button', { name: 'Try again' });
    expect(reload).toHaveBeenCalledOnce();
    // Try again reloads too: a failed import never retries in the same document.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('RoutePending', () => {
  it('announces loading', () => {
    render(<RoutePending />);
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
  });
});
