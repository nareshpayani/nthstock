import { strings } from '../strings';

/** The phone tab bar's tabs (NSTOCK-0466). Trade is an action, not a place, so it is not one. */
export type PhoneTab = 'home' | 'portfolio' | 'orders' | 'account';

/** The tab a page belongs to, or null for a page pushed over the tabs (a stock's page). */
export function phoneTabFor(pathname: string): PhoneTab | null {
  if (pathname === '/dashboard' || pathname === '/watchlist' || pathname === '/') return 'home';
  if (pathname === '/portfolio' || pathname === '/positions') return 'portfolio';
  if (pathname === '/orders') return 'orders';
  if (
    pathname === '/account' ||
    pathname === '/funds' ||
    pathname === '/guide' ||
    pathname.startsWith('/settings')
  )
    return 'account';
  return null;
}

/** Two sibling pages the top bar switches between, like a native segmented control. */
export type PhoneSwitch = {
  label: string;
  options: readonly [{ to: string; label: string }, { to: string; label: string }];
};

const HOME_SWITCH: PhoneSwitch = {
  label: strings.phone.homeView,
  options: [
    { to: '/dashboard', label: strings.phone.market },
    { to: '/watchlist', label: strings.phone.watchlist },
  ],
};

const PORTFOLIO_SWITCH: PhoneSwitch = {
  label: strings.phone.portfolioView,
  options: [
    { to: '/portfolio', label: strings.phone.holdings },
    { to: '/positions', label: strings.phone.positions },
  ],
};

/** What the phone top bar shows in its middle: a switch between sibling pages, or a title. */
export type PhoneTopBarCentre =
  { kind: 'switch'; value: PhoneSwitch } | { kind: 'title'; value: string };

export function phoneTopBarCentre(pathname: string): PhoneTopBarCentre {
  if (pathname === '/dashboard' || pathname === '/watchlist')
    return { kind: 'switch', value: HOME_SWITCH };
  if (pathname === '/portfolio' || pathname === '/positions')
    return { kind: 'switch', value: PORTFOLIO_SWITCH };
  const { titles } = strings.phone;
  if (pathname === '/orders') return { kind: 'title', value: titles.orders };
  if (pathname === '/account') return { kind: 'title', value: titles.account };
  if (pathname === '/funds') return { kind: 'title', value: titles.funds };
  if (pathname.startsWith('/settings')) return { kind: 'title', value: titles.security };
  if (pathname === '/guide') return { kind: 'title', value: titles.guide };
  if (pathname.startsWith('/stocks/'))
    return { kind: 'title', value: decodeURIComponent(pathname.slice('/stocks/'.length)) };
  return { kind: 'title', value: '' };
}
