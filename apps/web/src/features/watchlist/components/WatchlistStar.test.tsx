import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession, signOut } from '@/test/session';
import { findStock, loginOnMock } from '@/test/watchlists';
import { WatchlistStar } from './WatchlistStar';

const { server, adapter } = createMockServer({ clock: fixedClock(fromIst(2026, 9, 25, 16 * 60)) });
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetSession();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

const HEAVY = 20_000;
const INFY = { token: 0, symbol: 'INFY', exchange: 'NSE', name: 'Infosys Ltd' } as const;

describe('WatchlistStar (T-121)', () => {
  it('sends a logged-out user to log in and back', async () => {
    signOut();
    const { router } = renderWithProviders(<WatchlistStar instrument={INFY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add INFY to a watchlist' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ redirect: '/' });
  });

  it(
    'ticks lists in its menu, fills when the stock is in one, and the server keeps it',
    async () => {
      const apiClient = await loginOnMock('9813300001');
      const hit = await findStock(apiClient, 'INFY');
      await apiClient.request('watchlistCreate', { body: { name: 'IT' } });
      const { queryClient } = renderWithProviders(<WatchlistStar instrument={hit} />, {
        apiClient,
      });

      const star = await screen.findByRole('button', { name: 'Add INFY to a watchlist' });
      await waitFor(() => expect(star).toBeEnabled());
      fireEvent.keyDown(star, { key: 'Enter' });
      const it = await screen.findByRole('menuitemcheckbox', { name: 'IT' });
      expect(it).toHaveAttribute('aria-checked', 'false');
      fireEvent.click(it);

      // Optimistic: at once, before the server answers. (The open menu hides the page from
      // assistive tech, so read the star's label directly.)
      await waitFor(() =>
        expect(star).toHaveAttribute('aria-label', 'INFY is in your watchlist. Change watchlists'),
      );
      expect(screen.getByRole('menuitemcheckbox', { name: 'IT' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      const { items } = await apiClient.request('watchlistsList');
      expect(items.find((list) => list.name === 'IT')?.items.map((i) => i.symbol)).toEqual([
        'INFY',
      ]);

      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'IT' }));
      await waitFor(() => expect(star).toHaveAttribute('aria-label', 'Add INFY to a watchlist'));
      await act(async () => {
        await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      });
    },
    HEAVY,
  );
});
