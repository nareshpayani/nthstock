import type * as PhoneLayout from '@/shared/hooks/usePhoneLayout';
import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { renderApp } from '@/test/renderApp';
import { resetSession } from '@/test/session';
import { fakeLayout, loginOnMock, seedList } from '@/test/watchlists';

// jsdom has no matchMedia: switch the phone shell on here (NSTOCK-0466).
vi.mock('@/shared/hooks/usePhoneLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof PhoneLayout>()),
  usePhoneShell: () => true,
  usePhoneLayout: () => true,
}));

const { server, adapter } = createMockServer({ clock: fixedClock(fromIst(2026, 9, 25, 16 * 60)) });
let restoreLayout: () => void = () => undefined;

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  restoreLayout = fakeLayout(448);
});
afterEach(() => {
  server.resetHandlers();
  act(() => {
    resetSession();
    useTicketIntentStore.setState(initialTicketIntentState);
  });
  window.localStorage.clear();
});
afterAll(() => {
  server.close();
  adapter.dispose();
  restoreLayout();
});

// Each case logs in and makes several round trips on the MSW node server; CI runners are slow.
const HEAVY = 20_000;

async function renderPhoneWithList(url: string, mobile: string) {
  const apiClient = await loginOnMock(mobile);
  await seedList(apiClient, ['INFY']);
  return { apiClient, ...renderApp(url, { apiClient }) };
}

describe('phone add to watchlist (NSTOCK-0474)', () => {
  it(
    'Add stock opens an add sheet that adds a tapped stock without leaving the page',
    async () => {
      const { apiClient, router } = await renderPhoneWithList('/watchlist', '9000000741');
      fireEvent.click(await screen.findByRole('button', { name: 'Add stock' }));
      const sheet = await screen.findByRole('dialog', { name: 'Add to My Watchlist' });
      const input = within(sheet).getByRole('combobox', { name: 'Search stocks' });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'tcs' } });
      fireEvent.click(await within(sheet).findByRole('option', { name: /^TCS/ }));
      expect(within(sheet).getByRole('status')).toHaveTextContent('TCS added to My Watchlist');

      await waitFor(async () => {
        const { items } = await apiClient.request('watchlistsList');
        expect(items[0]?.items.map((item) => item.symbol)).toEqual(['INFY', 'TCS']);
      });
      expect(router.state.location.pathname).toBe('/watchlist');
      expect(screen.getByRole('dialog', { name: 'Add to My Watchlist' })).toBeInTheDocument();

      fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: /^Trade:/ }));
      expect(await screen.findByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'shows Add stock on the Home watchlist tab; a tap asks the shell for the add sheet',
    async () => {
      await renderPhoneWithList('/dashboard?feed=watchlist', '9000000742');
      const feed = await screen.findByRole('region', { name: 'Your stocks and market movers' });
      const { requests, addRequests } = useSearchFocusStore.getState();
      fireEvent.click(await within(feed).findByRole('button', { name: 'Add stock' }));
      expect(useSearchFocusStore.getState().addRequests).toBe(addRequests + 1);
      expect(useSearchFocusStore.getState().requests).toBe(requests);
      expect(
        await screen.findByRole('dialog', { name: 'Add to My Watchlist' }),
      ).toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'the Trade sheet gives every row a + that adds it without leaving (NSTOCK-0476)',
    async () => {
      const { apiClient, router } = await renderPhoneWithList('/watchlist', '9000000743');
      fireEvent.click(await screen.findByRole('button', { name: /^Trade:/ }));
      const sheet = await screen.findByRole('dialog', { name: 'Trade' });
      const input = within(sheet).getByRole('combobox', { name: 'Search stocks' });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'tcs' } });
      await within(sheet).findByRole('option', { name: /^TCS/ });
      expect(within(sheet).getByText('Tap + to add a stock to My Watchlist')).toBeInTheDocument();
      fireEvent.click(sheet.querySelector('[data-add-to-watchlist="TCS"]') as HTMLElement);
      expect(within(sheet).getByRole('status')).toHaveTextContent('TCS added to My Watchlist');
      await waitFor(async () => {
        const { items } = await apiClient.request('watchlistsList');
        expect(items[0]?.items.map((item) => item.symbol)).toEqual(['INFY', 'TCS']);
      });
      expect(router.state.location.pathname).toBe('/watchlist');
      expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
      // The real control for every user (the + is a tap shortcut): switch to the add sheet.
      fireEvent.click(within(sheet).getByRole('button', { name: 'Add stocks to My Watchlist' }));
      const adding = await screen.findByRole('dialog', { name: 'Add to My Watchlist' });
      await waitFor(() =>
        expect(within(adding).getByRole('combobox', { name: 'Search stocks' })).toHaveFocus(),
      );
    },
    HEAVY,
  );
});
