import type { QuoteStore } from '@nthstock/apiClient';
import type * as Ui from '@nthstock/ui';
import type { IndexTickerProps, LogoProps } from '@nthstock/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { AppProviders } from '../providers/AppProviders';
import { createQueryClient } from '../queryClient';
import { Header, type HeaderUser } from './Header';

// Render counters: Logo renders only when Header itself re-renders; IndexTicker once per ticker.
const counts = vi.hoisted(() => ({ logo: 0, tickers: new Map<string, number>() }));
vi.mock('@nthstock/ui', async (importOriginal) => {
  const ui = await importOriginal<typeof Ui>();
  return {
    ...ui,
    Logo: (props: LogoProps) => {
      counts.logo += 1;
      return createElement(ui.Logo, props);
    },
    IndexTicker: (props: IndexTickerProps) => {
      counts.tickers.set(props.name, (counts.tickers.get(props.name) ?? 0) + 1);
      return createElement(ui.IndexTicker, props);
    },
  };
});

function renderHeader(user: HeaderUser | null, quoteStore?: QuoteStore) {
  const onOpenHelp = vi.fn();
  const root = createRootRoute({
    component: () => <Header user={user} onOpenMenu={vi.fn()} onOpenHelp={onOpenHelp} />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <AppProviders queryClient={createQueryClient()} {...(quoteStore ? { quoteStore } : {})}>
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

describe('Header live tickers (T-092)', () => {
  it('a tick updates its ticker without re-rendering the rest of the header', async () => {
    const quotes = createTestQuoteStore();
    renderHeader(null, quotes.store);
    await screen.findByRole('link', { name: 'Log in' });
    // Both tickers render twice (wide bar and narrow strip) but share one subscription each.
    expect(quotes.subscribed.get('NSE:NIFTY50')).toBe(1);
    expect(quotes.subscribed.get('BSE:SENSEX')).toBe(1);
    expect(screen.getAllByText('NIFTY 50')).toHaveLength(2);

    act(() => {
      quotes.push(
        testQuote('NIFTY50', 2541860, { prevClose: 2520615 }),
        testQuote('SENSEX', 8309215, { exchange: 'BSE', prevClose: 8319185 }),
      );
    });
    expect(screen.getAllByText(/^NIFTY 50 25,418.60, up 212.45 points/)).toHaveLength(2);
    const logo = counts.logo;
    const nifty = counts.tickers.get('NIFTY 50') ?? 0;
    const sensex = counts.tickers.get('SENSEX') ?? 0;

    act(() => quotes.push(testQuote('NIFTY50', 2542000, { prevClose: 2520615 })));
    expect(screen.getAllByText(/^NIFTY 50 25,420.00, up 213.85 points/)).toHaveLength(2);
    expect(counts.tickers.get('NIFTY 50')).toBe(nifty + 2);
    expect(counts.tickers.get('SENSEX')).toBe(sensex);
    expect(counts.logo).toBe(logo);
  });

  it('shows the index names with a loading placeholder before the first quote', async () => {
    renderHeader(null);
    await screen.findByRole('link', { name: 'Log in' });
    expect(screen.getAllByText('SENSEX')).toHaveLength(2);
    expect(screen.queryByText(/Sample/)).not.toBeInTheDocument();
    const group = screen.getAllByRole('group', { name: 'Market indices' })[0];
    expect(group).not.toHaveAttribute('title');
  });
});
