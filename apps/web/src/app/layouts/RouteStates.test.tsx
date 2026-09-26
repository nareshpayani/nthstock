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
});

describe('RoutePending', () => {
  it('announces loading', () => {
    render(<RoutePending />);
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
  });
});
