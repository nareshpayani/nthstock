import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';
import { initialShellState, useShellStore } from '../shellStore';

afterEach(() => {
  act(() => useShellStore.setState(initialShellState));
});

async function renderDashboard() {
  const view = renderApp('/dashboard');
  await screen.findByRole('heading', { level: 1, name: /^Good/ });
  return view;
}

describe('Header (T-025)', () => {
  it('marks the active tab with aria-current="page"', async () => {
    const { router } = await renderDashboard();
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0] as HTMLElement;
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Orders' })).not.toHaveAttribute('aria-current');
    fireEvent.click(within(nav).getByRole('link', { name: 'Orders' }));
    await screen.findByRole('heading', { level: 1, name: 'Orders' });
    expect(router.state.location.pathname).toBe('/orders');
    expect(within(nav).getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the index tickers with arrows and text, and a market status', async () => {
    await renderDashboard();
    expect(
      screen.getAllByText(/NIFTY 50 25,418.60, up 212.45 points, up 0.84 percent/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole('status', { name: /NSE market status/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
});

describe('shortcuts (T-028)', () => {
  it('? opens the shortcut list and Esc closes it', async () => {
    await renderDashboard();
    fireEvent.keyDown(document.body, { key: '?' });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Search stocks')).toBeInTheDocument();
    expect(within(dialog).getByText('/')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('/ typed inside the search input does not fire the shortcut', async () => {
    await renderDashboard();
    const search = screen.getAllByRole('searchbox', { name: 'Search stocks' })[0] as HTMLElement;
    search.focus();
    fireEvent.keyDown(search, { key: '/' });
    fireEvent.keyDown(search, { key: '?' });
    expect(useShellStore.getState().drawerOpen).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('/ opens the drawer with search when the rail is hidden (jsdom has no layout)', async () => {
    await renderDashboard();
    fireEvent.keyDown(document.body, { key: '/' });
    const drawer = await screen.findByRole('dialog', { name: 'Menu' });
    await waitFor(() =>
      expect(within(drawer).getByRole('searchbox', { name: 'Search stocks' })).toHaveFocus(),
    );
  });
});

describe('drawer and more menu', () => {
  it('menu button opens the drawer with the tabs; choosing a tab closes it', async () => {
    const { router } = await renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Menu' });
    fireEvent.click(within(drawer).getByRole('link', { name: 'Funds' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe('/funds');
  });

  it('support opens help, and Add stock in the rail focuses search', async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Help and support' }));
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('More opens a menu with keyboard shortcuts', async () => {
    await renderDashboard();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: /Keyboard shortcuts/ });
    fireEvent.click(item);
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });
});
