import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../providers/AppProviders';
import { createQueryClient } from '../queryClient';
import { Header, type HeaderUser } from './Header';

function renderHeader(user: HeaderUser | null) {
  const onOpenHelp = vi.fn();
  const root = createRootRoute({
    component: () => <Header user={user} onOpenMenu={vi.fn()} onOpenHelp={onOpenHelp} />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { onOpenHelp };
}

describe('Header profile slot', () => {
  it('signed in: shows initials and an account menu', async () => {
    renderHeader({ name: 'Asha Rao' });
    const account = await screen.findByRole('button', { name: 'Account: Asha Rao' });
    expect(account).toHaveTextContent('AR');
    fireEvent.keyDown(account, { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: /Log out/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('signed out: shows Log in', async () => {
    renderHeader(null);
    expect(await screen.findByRole('link', { name: 'Log in' })).toBeInTheDocument();
  });
});
