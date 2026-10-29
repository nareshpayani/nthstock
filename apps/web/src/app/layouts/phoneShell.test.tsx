import type * as PhoneLayout from '@/shared/hooks/usePhoneLayout';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn, signOut, testSession } from '@/test/session';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { phoneTabFor, phoneTopBarCentre } from './phoneNav';

// jsdom has no matchMedia: switch the phone shell on here (NSTOCK-0466).
vi.mock('@/shared/hooks/usePhoneLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof PhoneLayout>()),
  usePhoneShell: () => true,
  usePhoneLayout: () => true,
}));

afterEach(() => {
  act(() => resetSession());
});

function renderPhone(url: string, { signedIn = true } = {}) {
  if (signedIn) signIn(testSession({ name: 'Demo Investor' }));
  else signOut();
  const quotes = createTestQuoteStore();
  quotes.push(testQuote('NIFTY50', 2541860, { prevClose: 2520615 }));
  return renderApp(url, { quoteStore: quotes.store });
}

const tabBar = () => screen.getAllByRole('navigation', { name: 'Main' }).at(-1) as HTMLElement;

describe('phone navigation map (NSTOCK-0466)', () => {
  it('puts every desktop page under a tab, and stock pages over the tabs', () => {
    expect(phoneTabFor('/dashboard')).toBe('home');
    expect(phoneTabFor('/watchlist')).toBe('home');
    expect(phoneTabFor('/portfolio')).toBe('portfolio');
    expect(phoneTabFor('/positions')).toBe('portfolio');
    expect(phoneTabFor('/orders')).toBe('orders');
    for (const path of ['/account', '/funds', '/guide', '/settings/security'])
      expect(phoneTabFor(path)).toBe('account');
    expect(phoneTabFor('/stocks/INFY')).toBeNull();
  });

  it('gives sibling pages a switch and the rest a title', () => {
    expect(phoneTopBarCentre('/dashboard').kind).toBe('switch');
    expect(phoneTopBarCentre('/positions').kind).toBe('switch');
    expect(phoneTopBarCentre('/orders')).toEqual({ kind: 'title', value: 'Orders' });
    expect(phoneTopBarCentre('/settings/security')).toEqual({ kind: 'title', value: 'Security' });
    expect(phoneTopBarCentre('/stocks/INFY')).toEqual({ kind: 'title', value: 'INFY' });
    expect(phoneTopBarCentre('/nowhere')).toEqual({ kind: 'title', value: '' });
  });

  it('does not throw on a malformed stock path', () => {
    expect(phoneTopBarCentre('/stocks/%E0')).toEqual({ kind: 'title', value: '%E0' });
    expect(phoneTopBarCentre('/stocks/M%26M')).toEqual({ kind: 'title', value: 'M&M' });
  });
});

describe('phone app shell (NSTOCK-0466)', () => {
  it('shows the tab bar and the Home switch instead of the menu', async () => {
    renderPhone('/dashboard');
    await screen.findByRole('heading', { level: 1, name: 'Portfolio value' });
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
    const tabs = tabBar();
    expect(within(tabs).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['Portfolio', 'Orders', 'Account'])
      expect(within(tabs).getByRole('link', { name })).toBeInTheDocument();
    const view = screen.getByRole('navigation', { name: 'Home view' });
    expect(within(view).getByRole('link', { name: 'Market' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /DI, account/ })).toHaveAttribute('href', '/account');
  });

  it('opens the trade sheet from the Trade button and from a search request', async () => {
    renderPhone('/dashboard');
    await screen.findByRole('heading', { level: 1, name: 'Portfolio value' });
    fireEvent.click(screen.getByRole('button', { name: /^Trade:/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Trade' });
    expect(within(sheet).getByRole('combobox', { name: 'Search stocks' })).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trade' })).toBeNull());
    act(() => useSearchFocusStore.getState().requestSearch());
    expect(await screen.findByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
  });

  it('pushes a stock page over the tabs, with a back button', async () => {
    renderPhone('/stocks/INFY');
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Trade:/ })).not.toBeInTheDocument();
  });

  it('shows Account with its menu and Log out when signed in', async () => {
    renderPhone('/account');
    expect(await screen.findByRole('region', { name: 'Profile' })).toHaveTextContent(
      'Demo Investor',
    );
    const menu = screen.getByRole('navigation', { name: 'Account' });
    for (const name of [
      /^Funds/,
      /^Positions/,
      /^Watchlists/,
      /^Security and privacy/,
      /^Help and documentation/,
    ])
      expect(within(menu).getByRole('link', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(await screen.findByText('Balance unavailable')).toBeInTheDocument();
  });

  it('logs out from Account and lands on the login page', async () => {
    renderPhone('/account');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
  });

  it('asks to log in on Account and Home when signed out', async () => {
    renderPhone('/account', { signedIn: false });
    expect(
      await screen.findByRole('heading', { name: 'Log in to your account' }),
    ).toBeInTheDocument();
  });

  it('shows the virtual cash on Home when signed out', async () => {
    renderPhone('/dashboard', { signedIn: false });
    expect(await screen.findByText('Virtual cash to practise with')).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Log in' }),
    ).toBeInTheDocument();
  });

  it('gives the watchlists a page of their own', async () => {
    renderPhone('/watchlist');
    expect(await screen.findByRole('heading', { level: 1, name: 'Watchlist' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Watchlists' })).toBeInTheDocument();
  });
});
