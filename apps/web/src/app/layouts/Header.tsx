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
import { NotificationBell } from '@/features/notifications';
import { useAutoScroll } from '@/shared/hooks/useAutoScroll';
import { usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { strings } from '../strings';
import { navItems } from './navItems';

export type HeaderProps = {
  onOpenMenu: () => void;
  onOpenHelp: () => void;
};

/**
 * Top bar in the reference layout: logo, Nifty 50 and Sensex, main tabs, market status, support,
 * profile and More. Below 1360 px the tickers and status move to a strip under the bar; below
 * 1024 px the tabs move into the menu drawer. On a phone the strip packs tighter (SPEC-CR-1 §6.2):
 * a status dot with one word, and each index with its name above the figures, so both fit from
 * 320 px; anything narrower scrolls inside the strip, with a fade at the edge.
 */
export function Header({ onOpenMenu, onOpenHelp }: HeaderProps) {
  const phone = usePhoneLayout();
  // The strip drifts so every index gets seen on a narrow phone (A21).
  const stripRef = useAutoScroll<HTMLDivElement>(phone);
  return (
    <header className="sticky top-0 z-(--nth-z-header) border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 lg:gap-5 lg:px-6">
        <IconButton
          label={strings.header.openMenu}
          icon={<IconMenu />}
          onClick={onOpenMenu}
          className="lg:hidden"
        />
        <Link to="/dashboard" className="shrink-0 rounded-md">
          <Logo className="text-[28px] sm:text-[32px]" />
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
          {/* Under 360 px the bar has no room for it; More holds the same help. */}
          <Tooltip content={strings.header.support}>
            <IconButton
              label={strings.header.support}
              icon={<IconSupport />}
              onClick={onOpenHelp}
              className="max-[359px]:hidden"
            />
          </Tooltip>
          <NotificationBell />
          <ProfileMenu />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={strings.header.more} icon={<IconMore />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {/* The support icon is hidden under 360 px, so help stays reachable by name here. */}
              <DropdownMenuItem onSelect={onOpenHelp} className="min-[360px]:hidden">
                <IconSupport size={16} /> {strings.header.support}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenHelp}>
                <IconKeyboard size={16} /> {strings.header.shortcuts}
                <kbd className="ml-auto font-mono text-label text-ink-muted">?</kbd>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                {strings.header.holidays}
                <span className="ml-auto text-label">{strings.header.soon}</span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/guide">{strings.header.guide}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Scrolls sideways on narrow screens, so it takes focus for keyboard scrolling (WCAG 2.1.1,
          axe scrollable-region-focusable). */}
      <div
        ref={stripRef}
        role="region"
        aria-label={strings.header.statusStrip}
        tabIndex={0}
        className="relative flex h-10 items-center gap-4 overflow-x-auto border-t border-line px-3 max-[359px]:mask-r-from-85% lg:px-6 min-[1360px]:hidden"
      >
        <MarketStatusPill compact={!phone} dot={phone} className="shrink-0" />
        <HeaderTickers compact stacked={phone} all={phone} className="shrink-0" />
      </div>
    </header>
  );
}
