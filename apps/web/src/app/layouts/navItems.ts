import { strings } from '../strings';

/** Main tabs, in the reference order. */
export const navItems = [
  { to: '/dashboard', label: strings.nav.dashboard },
  { to: '/portfolio', label: strings.nav.portfolio },
  { to: '/positions', label: strings.nav.positions },
  { to: '/orders', label: strings.nav.orders },
  { to: '/funds', label: strings.nav.funds },
] as const;
