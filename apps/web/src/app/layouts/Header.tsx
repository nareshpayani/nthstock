import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  IconKeyboard,
  IconMenu,
  IconMore,
  IconSupport,
  Logo,
  Tooltip,
} from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { ProfileMenu } from '@/features/auth';
import { HeaderTickers, MarketStatusPill } from '@/features/marketTicker';
import { strings } from '../strings';
import { navItems } from './navItems';

export type HeaderProps = {
  onOpenMenu: () => void;
  onOpenHelp: () => void;
};

/**
 * Top bar in the reference layout: logo, Nifty 50 and Sensex, main tabs, market status, support,
 * profile and More. Below 1360 px the tickers and status move to a strip under the bar; below
 * 1024 px the tabs move into the menu drawer.
 */
export function Header({ onOpenMenu, onOpenHelp }: HeaderProps) {
  return (
    <header className="sticky top-0 z-(--nth-z-header) border-b border-line bg-surface">
      <div className="flex h-14 items-center gap-3 px-3 lg:gap-5 lg:px-6">
        <IconButton
          label={strings.header.openMenu}
          icon={<IconMenu />}
          onClick={onOpenMenu}
          className="lg:hidden"
        />
        <Link to="/dashboard" aria-label={strings.header.home} className="shrink-0 rounded-md">
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
          <ProfileMenu />
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
      {/* Scrolls sideways on narrow screens, so it takes focus for keyboard scrolling (WCAG 2.1.1,
          axe scrollable-region-focusable). */}
      <div
        role="region"
        aria-label={strings.header.statusStrip}
        tabIndex={0}
        className="relative flex h-10 items-center gap-4 overflow-x-auto border-t border-line px-3 lg:px-6 min-[1360px]:hidden"
      >
        <MarketStatusPill compact className="shrink-0" />
        <HeaderTickers compact className="shrink-0" />
      </div>
    </header>
  );
}
