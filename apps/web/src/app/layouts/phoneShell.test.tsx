import type * as PhoneLayout from '@/shared/hooks/usePhoneLayout';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@nthstock/apiClient';
import type { FundsSummary, Holding } from '@nthstock/contracts';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn, signOut, testSession } from '@/test/session';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { useSessionStore } from '@/shared/lib/sessionStore';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { phoneTabFor, phoneTopBarCentre } from './phoneNav';

// jsdom has no matchMedia: switch the phone shell on here (NSTOCK-0466).
vi.mock('@/shared/hooks/usePhoneLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof PhoneLayout>()),
  usePhoneShell: () => true,
  usePhoneLayout: () => true,
}));

afterEach(() => {
  act(() => {
    resetSession();
    useTicketIntentStore.setState(initialTicketIntentState);
  });
});

const AS_OF = '2026-09-28T04:30:00.000Z';
const fundsSummaryFixture: FundsSummary = {
  openingBalance: 10_00_000_00,
  balance: 8_60_000_00,
  blocked: 15_234_50,
  available: 8_44_765_50,
  realisedPnlToday: 0,
  asOf: AS_OF,
};
const holdingFixture: Holding = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  qty: 10,
  avgPrice: 140_000,
  ltp: 152_345,
  investedValue: 1_400_000,
  currentValue: 1_523_450,
  pnl: 123_450,
  pnlBp: 882,
  dayChange: -12_550,
  dayChangeBp: -82,
};

const popularFixture = {
  items: [
    { token: 408065, symbol: 'INFY', exchange: 'NSE', name: 'Infosys Ltd', type: 'EQUITY' },
    {
      token: 519937,
      symbol: 'M&M',
      exchange: 'NSE',
      name: 'Mahindra & Mahindra Ltd',
      type: 'EQUITY',
    },
  ],
};

/**
 * A client that answers funds, holdings and popular searches from the fixtures and fails
 * everything else; `failFunds` fails funds too, for the error states.
 */
/** Every path the fixture client was asked for, in order. */
const fetched: string[] = [];

function portfolioApi({ failFunds = false, hangRefresh = false } = {}) {
  return createApiClient({
    baseUrl: 'http://portfolio.test',
    fetch: (input) => {
      const path = new URL(String(input)).pathname;
      fetched.push(path);
      // The session check still in flight: the page stays in its "unknown" state.
      if (hangRefresh && path === '/v1/auth/refresh') return new Promise<Response>(() => undefined);
      const body =
        path === '/v1/auth/logout'
          ? { ok: true }
          : path === '/v1/funds' && !failFunds
            ? fundsSummaryFixture
            : path === '/v1/holdings'
              ? { items: [holdingFixture] }
              : path === '/v1/market/search/popular'
                ? popularFixture
                : null;
      if (!body) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    },
  });
}

function renderPhone(
  url: string,
  {
    signedIn = true,
    data = false,
    failFunds = false,
  }: { signedIn?: boolean | 'unknown'; data?: boolean; failFunds?: boolean } = {},
) {
  if (signedIn === true) signIn(testSession({ name: 'Demo Investor' }));
  else if (signedIn === false) signOut();
  const quotes = createTestQuoteStore();
  quotes.push(testQuote('NIFTY50', 2541860, { prevClose: 2520615 }));
  const hangRefresh = signedIn === 'unknown';
  return renderApp(url, {
    quoteStore: quotes.store,
    ...(data || failFunds || hangRefresh
      ? { apiClient: portfolioApi({ failFunds, hangRefresh }) }
      : {}),
  });
}

/** Opens the Trade sheet and picks a stock (INFY unless told) from the popular searches. */
async function pickFromTradeSheet(symbol = 'INFY') {
  fireEvent.click(await screen.findByRole('button', { name: /^Trade:/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Trade' });
  fireEvent.focus(within(sheet).getByRole('combobox', { name: 'Search stocks' }));
  fireEvent.click(await within(sheet).findByRole('option', { name: new RegExp(`^${symbol}`) }));
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

  it('titles a stock page with the raw segment when it is not valid percent-encoding', () => {
    expect(phoneTopBarCentre('/stocks/M%26M')).toEqual({ kind: 'title', value: 'M&M' });
    expect(phoneTopBarCentre('/stocks/%E0')).toEqual({ kind: 'title', value: '%E0' });
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

  it('pushes a stock page over the tabs; Back opened directly goes Home', async () => {
    const { router } = renderPhone('/stocks/INFY');
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    // No tab bar on the stock page: the desktop has no "Main" nav on a phone either.
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  it('hides the tab bar on a stock page, and Back returns to where the user was', async () => {
    const { router } = renderPhone('/orders');
    await waitFor(() => expect(tabBar()).toBeInTheDocument());
    await act(() => router.navigate({ to: '/stocks/$symbol', params: { symbol: 'INFY' } }));
    await screen.findByRole('button', { name: 'Back' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Trade:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders'));
  });

  it('shows the portfolio value, cash plus holdings, and the day’s P&L once they load', async () => {
    renderPhone('/dashboard', { data: true });
    const hero = await screen.findByRole('region', { name: 'Portfolio value' });
    // Cash ₹8,60,000.00 plus INFY's current value ₹15,234.50; the day moved ₹125.50 down.
    await waitFor(() => expect(hero).toHaveTextContent('₹8,75,234.50'));
    expect(hero).toHaveTextContent(/▼.*125\.50/);
    expect(hero).toHaveTextContent('today');
    expect(screen.queryByText('Virtual cash to practise with')).not.toBeInTheDocument();
  });

  it('shows the cash available to trade on Account once it loads', async () => {
    renderPhone('/account', { data: true });
    expect(await screen.findByText('₹8,44,765.50')).toBeInTheDocument();
  });

  it('says when the portfolio value could not load, with a retry', async () => {
    renderPhone('/dashboard', { failFunds: true });
    const hero = await screen.findByRole('region', { name: 'Portfolio value' });
    expect(await within(hero).findByRole('alert')).toHaveTextContent(
      'Your portfolio value could not load',
    );
    // Try again asks for the failed figure again, and only that one.
    const fundsCalls = () => fetched.filter((path) => path === '/v1/funds').length;
    const holdingsCalls = () => fetched.filter((path) => path === '/v1/holdings').length;
    const [funds, holdings] = [fundsCalls(), holdingsCalls()];
    fireEvent.click(within(hero).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fundsCalls()).toBe(funds + 1));
    expect(holdingsCalls()).toBe(holdings);
  });

  it('opens the stock with the ticket from the Trade sheet', async () => {
    const { router } = renderPhone('/dashboard', { data: true });
    await pickFromTradeSheet();
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/INFY'));
    expect(useTicketIntentStore.getState().intent).toMatchObject({
      symbol: 'INFY',
      exchange: 'NSE',
      side: 'BUY',
    });
  });

  it('signed out, the Trade sheet sends login back to the picked stock', async () => {
    const { router } = renderPhone('/dashboard', { signedIn: false, data: true });
    await pickFromTradeSheet();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toHaveProperty('redirect', '/stocks/INFY');
  });

  it('logs out from Account once the server has ended the session', async () => {
    const { router } = renderPhone('/account', { data: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('stays logged in, and says so, when log out cannot reach the server', async () => {
    const { router } = renderPhone('/account');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('You are still logged in')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account');
    expect(useSessionStore.getState().session).not.toBeNull();
  });

  it('waits in a skeleton, not the virtual cash, while the session is being checked', async () => {
    renderPhone('/dashboard', { signedIn: 'unknown' });
    const hero = await screen.findByRole('region', { name: 'Portfolio value' });
    expect(within(hero).getByRole('status')).toHaveTextContent('Loading your portfolio value');
    expect(screen.queryByText('Virtual cash to practise with')).not.toBeInTheDocument();
  });

  it('waits on Account too, without the log-in card, while the session is being checked', async () => {
    renderPhone('/account', { signedIn: 'unknown' });
    expect(await screen.findByText('Checking your session')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Log in to your account' })).toBeNull();
  });

  it('encodes the picked stock in the login redirect (M&M)', async () => {
    const { router } = renderPhone('/dashboard', { signedIn: false, data: true });
    await pickFromTradeSheet('M&M');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toHaveProperty('redirect', '/stocks/M%26M');
    expect(useTicketIntentStore.getState().intent).toMatchObject({
      symbol: 'M&M',
      exchange: 'NSE',
      side: 'BUY',
    });
  });

  it('switches Home feed tabs and the movers index through the URL', async () => {
    const { router } = renderPhone('/dashboard?feed=gainers');
    const feed = await screen.findByRole('tablist', { name: 'Stocks' });
    expect(within(feed).getByRole('tab', { name: 'Gainers' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const index = screen.getAllByRole('radiogroup', { name: 'Index' })[0] as HTMLElement;
    const radios = within(index).getAllByRole('radio');
    fireEvent.click(radios[1] as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toHaveProperty('moversIndex'));
    fireEvent.mouseDown(within(feed).getByRole('tab', { name: 'Losers' }));
    await waitFor(() => expect(router.state.location.search).toHaveProperty('feed', 'losers'));
  });

  it('opens the trade sheet from Place order on Home', async () => {
    renderPhone('/dashboard');
    fireEvent.click(await screen.findByRole('button', { name: 'Place order' }));
    expect(await screen.findByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('retries the cash on Account after it fails', async () => {
    renderPhone('/account', { failFunds: true });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    const fundsCalls = () => fetched.filter((path) => path === '/v1/funds').length;
    const before = fundsCalls();
    fireEvent.click(retry);
    await waitFor(() => expect(fundsCalls()).toBe(before + 1));
  });

  it('shows the watchlist bare on Home: no second Watchlists heading inside the tab', async () => {
    renderPhone('/dashboard?feed=watchlist');
    const feed = await screen.findByRole('region', { name: 'Your stocks and market movers' });
    expect(within(feed).queryByRole('button', { name: /^Watchlists/ })).toBeNull();
  });

  it('asks to log in on Account when signed out', async () => {
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
