import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  IconKeyboard,
  IconLogout,
  IconMenu,
  IconMore,
  IconSupport,
  IconUser,
  Logo,
  Tooltip,
  buttonVariants,
} from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { HeaderTickers, MarketStatusPill } from '@/features/marketTicker';
import { strings } from '../strings';
import { navItems } from './navItems';

export type HeaderUser = { name: string };

export type HeaderProps = {
  /** Signed-in user, or null when signed out. */
  user: HeaderUser | null;
  onOpenMenu: () => void;
  onOpenHelp: () => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Top bar in the reference layout: logo, Nifty 50 and Sensex, main tabs, market status, support,
 * profile and More. Below 1360 px the tickers and status move to a strip under the bar; below
 * 1024 px the tabs move into the menu drawer.
 */
export function Header({ user, onOpenMenu, onOpenHelp }: HeaderProps) {
  return (
    <header className="sticky top-0 z-(--nth-z-header) border-b border-line bg-surface">
      <div className="flex h-14 items-center gap-3 px-3 lg:gap-5 lg:px-6">
        <IconButton
          label={strings.header.openMenu}
          icon={<IconMenu />}
          onClick={onOpenMenu}
          className="lg:hidden"
        />
        <Link to="/dashboard" aria-label="nthstock home" className="shrink-0 rounded-md">
          <Logo />
        </Link>
        <HeaderTickers
          compact
          className="hidden shrink-0 border-l border-line pl-5 min-[1360px]:flex"
        />
        <nav aria-label={strings.nav.label} className="hidden h-full lg:flex">
          <ul className="flex h-full">
            {navItems.map((item) => (
              <li key={item.to} className="h-full">
                <Link
                  to={item.to}
                  className="flex h-full items-center border-b-2 border-transparent px-2.5 text-body font-medium text-ink-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:text-brand"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <MarketStatusPill compact className="mr-2 hidden min-[1360px]:inline-flex" />
          <Tooltip content={strings.header.support}>
            <IconButton
              label={strings.header.support}
              icon={<IconSupport />}
              onClick={onOpenHelp}
            />
          </Tooltip>
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={strings.header.account(user.name)}
                  className="ml-1 flex size-9 items-center justify-center rounded-pill bg-brand text-label font-semibold text-surface"
                >
                  {initials(user.name)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem disabled>
                  <IconUser size={16} /> {strings.header.profile}
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <IconLogout size={16} /> {strings.header.logOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              to="/login"
              className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'ml-1' })}
            >
              {strings.header.logIn}
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={strings.header.more} icon={<IconMore />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onOpenHelp}>
                <IconKeyboard size={16} /> {strings.header.shortcuts}
                <kbd className="ml-auto font-mono text-label text-ink-muted">?</kbd>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                {strings.header.holidays}
                <span className="ml-auto text-label">{strings.header.soon}</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                {strings.header.about}
                <span className="ml-auto text-label">{strings.header.soon}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="relative flex h-10 items-center gap-4 overflow-x-auto border-t border-line px-3 lg:px-6 min-[1360px]:hidden">
        <MarketStatusPill compact className="shrink-0" />
        <HeaderTickers compact className="shrink-0" />
      </div>
    </header>
  );
}
