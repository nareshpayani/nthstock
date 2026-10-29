import {
  IconHome,
  IconOrders,
  IconPie,
  IconTrade,
  IconUser,
  cn,
  type IconComponent,
} from '@nthstock/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { strings } from '../strings';
import { phoneTabFor, type PhoneTab } from './phoneNav';

type TabLink = { tab: PhoneTab; to: string; label: string; icon: IconComponent };

const LEFT: readonly TabLink[] = [
  { tab: 'home', to: '/dashboard', label: strings.phone.tabs.home, icon: IconHome },
  { tab: 'portfolio', to: '/portfolio', label: strings.phone.tabs.portfolio, icon: IconPie },
];
const RIGHT: readonly TabLink[] = [
  { tab: 'orders', to: '/orders', label: strings.phone.tabs.orders, icon: IconOrders },
  { tab: 'account', to: '/account', label: strings.phone.tabs.account, icon: IconUser },
];

function Tab({ item, active }: { item: TabLink; active: boolean }) {
  const Icon = item.icon;
  return (
    <li className="flex justify-center">
      <Link
        to={item.to}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium text-ink-muted',
          active && 'font-semibold text-brand',
        )}
      >
        <Icon size={24} strokeWidth={active ? 2.25 : 1.75} />
        {item.label}
      </Link>
    </li>
  );
}

export type BottomTabBarProps = { onTrade: () => void };

/**
 * The phone app's tab bar (NSTOCK-0466), in thumb reach at the bottom of the screen: Home,
 * Portfolio, a raised Trade button in the centre (search a stock, then the order ticket), Orders
 * and Account. Pages under a tab (Positions under Portfolio, Funds under Account) light their tab.
 * Pads itself for the home indicator.
 */
export function BottomTabBar({ onTrade }: BottomTabBarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = phoneTabFor(pathname);
  return (
    <nav
      aria-label={strings.phone.tabs.label}
      className="fixed inset-x-0 bottom-0 z-(--nth-z-header) border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid h-(--nth-tabbar-h) grid-cols-5 items-center px-1">
        {LEFT.map((item) => (
          <Tab key={item.tab} item={item} active={current === item.tab} />
        ))}
        <li className="flex justify-center">
          <button
            type="button"
            aria-label={strings.phone.tabs.trade}
            onClick={onTrade}
            className="-mt-7 grid size-15 place-items-center rounded-pill border-4 border-canvas bg-brand text-surface shadow-raised transition-transform active:scale-95"
          >
            <IconTrade size={26} strokeWidth={2.25} />
          </button>
        </li>
        {RIGHT.map((item) => (
          <Tab key={item.tab} item={item} active={current === item.tab} />
        ))}
      </ul>
    </nav>
  );
}
