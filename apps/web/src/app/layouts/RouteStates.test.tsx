import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteError, RoutePending } from './RouteStates';
import { InShellContext } from './shellContext';

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

  describe('when the route code is from an older deploy', () => {
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://nthstock-a13a5.web.app/assets/dashboard-ul55Qa07.js',
    );

    function renderStale() {
      const reload = vi.fn();
      vi.stubGlobal('location', { ...window.location, reload });
      const reset = vi.fn();
      const root = createRootRoute({
        component: () => <RouteError error={error} reset={reset} />,
      });
      const router = createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ['/'] }),
      });
      render(<RouterProvider router={router} />);
      return { reload, reset };
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      window.sessionStorage.clear();
    });

    it('reloads to the current build, and Try again reloads too', async () => {
      const { reload, reset } = renderStale();
      await screen.findByRole('button', { name: 'Try again' });
      expect(reload).toHaveBeenCalledOnce();
      // A failed import never retries in the same document, so Try again reloads as well.
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reload).toHaveBeenCalledTimes(2);
      expect(reset).not.toHaveBeenCalled();
    });

    it('shows the card without reloading when it reloaded a moment ago; Try again still reloads', async () => {
      window.sessionStorage.setItem('nthstock:staleBuildReloadAt', String(Date.now()));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { reload } = renderStale();
      await screen.findByRole('button', { name: 'Try again' });
      expect(reload).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reload).toHaveBeenCalledOnce();
    });
  });
});

describe('RoutePending', () => {
  function renderAt(path: string, inShell = false) {
    const root = createRootRoute({
      component: () => (
        <InShellContext.Provider value={inShell}>
          <RoutePending />
        </InShellContext.Provider>
      ),
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    render(<RouterProvider router={router} />);
  }

  it('announces loading', async () => {
    renderAt('/portfolio');
    expect(await screen.findByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    expect(screen.queryByTestId('instrument-skeleton')).not.toBeInTheDocument();
  });

  it('draws the instrument page in its own shape, with the shell on a cold load (CR-T17)', async () => {
    renderAt('/stocks/INFY');
    expect(await screen.findByTestId('instrument-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    expect(screen.getByTestId('shell-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('chart-skeleton')).toHaveLength(1);
  });

  it('leaves the shell out once the shell is there', async () => {
    renderAt('/stocks/INFY', true);
    expect(await screen.findByTestId('instrument-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-skeleton')).not.toBeInTheDocument();
  });
});
