import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  IconChevronLeft,
  IconKeyboard,
  IconMenu,
  IconMore,
  IconSupport,
  Logo,
  Tooltip,
} from '@nthstock/ui';
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { AccountAvatar, ProfileMenu } from '@/features/auth';
import { HeaderTickers, MarketStatusPill } from '@/features/marketTicker';
import { NotificationBell } from '@/features/notifications';
import { useAutoScroll } from '@/shared/hooks/useAutoScroll';
import { usePhoneLayout, usePhoneShell } from '@/shared/hooks/usePhoneLayout';
import { strings } from '../strings';
import { navItems } from './navItems';
import { phoneTabFor, phoneTopBarCentre, type PhoneSwitch } from './phoneNav';

export type HeaderProps = {
  onOpenMenu: () => void;
  onOpenHelp: () => void;
};

/** Two sibling pages as a pill switch (Market | Watchlist): links, since each is its own page. */
function PageSwitch({ value, pathname }: { value: PhoneSwitch; pathname: string }) {
  return (
    <nav aria-label={value.label} className="min-w-0">
      <ul className="flex gap-0.5 rounded-pill bg-canvas p-0.5">
        {value.options.map((option) => (
          <li key={option.to}>
            <Link
              to={option.to}
              replace
              aria-current={pathname === option.to ? 'page' : undefined}
              className="flex h-11 items-center rounded-pill px-3 text-body font-medium whitespace-nowrap text-ink-muted aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-raised min-[360px]:px-4"
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The phone app's top bar (NSTOCK-0466): the avatar (to Account) on the left, the page's switch or
 * title in the middle, the bell on the right. A page pushed over the tabs (a stock) gets a back
 * button in place of the avatar, since the tab bar is not there to leave it by.
 */
function PhoneTopBar() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const centre = phoneTopBarCentre(pathname);
  const pushed = phoneTabFor(pathname) === null;
  const back = () => {
    // Back within the app when it has an entry to go back to; a page opened from a link (or a new
    // tab) goes to Home rather than off the site.
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: '/dashboard' });
  };
  return (
    <div className="grid h-14 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 px-2">
      {pushed ? (
        <IconButton label={strings.phone.back} icon={<IconChevronLeft />} onClick={back} />
      ) : (
        <AccountAvatar />
      )}
      <div className="flex min-w-0 justify-center">
        {centre.kind === 'switch' ? (
          <PageSwitch value={centre.value} pathname={pathname} />
        ) : (
          <p className="truncate text-lg font-semibold text-ink">{centre.value}</p>
        )}
      </div>
      <NotificationBell />
    </div>
  );
}

/**
 * Top bar in the reference layout: logo, Nifty 50 and Sensex, main tabs, market status, support,
 * profile and More. Below 1360 px the tickers and status move to a strip under the bar; below
 * 1024 px the tabs move into the menu drawer. On a phone the strip packs tighter (SPEC-CR-1 §6.2):
 * a status dot with one word, and each index with its name above the figures. All five indices
 * do not fit, so the strip drifts and scrolls sideways, with a fade at the edge as the cue.
 */
export function Header({ onOpenMenu, onOpenHelp }: HeaderProps) {
  const phone = usePhoneLayout();
  const phoneShell = usePhoneShell();
  // The strip drifts so every index gets seen on a narrow phone (A21).
  const stripRef = useAutoScroll<HTMLDivElement>(phone);
  return (
    <header className="sticky top-0 z-(--nth-z-header) border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
      {phoneShell ? (
        <PhoneTopBar />
      ) : (
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
      )}
      {/* Scrolls sideways on narrow screens, so it takes focus for keyboard scrolling (WCAG 2.1.1,
          axe scrollable-region-focusable). */}
      <div
        ref={stripRef}
        role="region"
        aria-label={strings.header.statusStrip}
        tabIndex={0}
        className="relative flex h-10 items-center gap-4 overflow-x-auto border-t border-line px-3 max-[767px]:mask-r-from-85% lg:px-6 min-[1360px]:hidden [@media(orientation:landscape)_and_(max-height:500px)]:hidden"
      >
        <MarketStatusPill compact={!phone} dot={phone} className="shrink-0" />
        <HeaderTickers compact stacked={phone} all={phone} className="shrink-0" />
      </div>
    </header>
  );
}
