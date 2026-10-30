import { Sheet, cn } from '@nthstock/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  OrderTicketHost,
  PositionEditorHost,
  TrailingStopSheetHost,
  useDockedPanelOpen,
} from '@/features/orderTicket';
import { NotificationsBridge } from '@/features/notifications';
import { OrderUpdatesBridge } from '@/features/orders';
import { useMarkFirstPaint } from '../firstPaint';
import { TradingIntentTimeouts } from '../live/TradingIntentTimeouts';
import { TrailingStopAnnouncer } from '../live/TrailingStopAnnouncer';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNarrowScreen, usePhoneShell } from '@/shared/hooks/usePhoneLayout';
import { useShortcut } from '@/shared/hooks/useShortcut';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { useShellStore } from '../store/shellStore';
import { strings } from '../strings';
import { BottomTabBar } from './BottomTabBar';
import { Header } from './Header';
import { LeftRail } from './LeftRail';
import { navItems } from './navItems';
import { phoneTabFor } from './phoneNav';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';
import { OrderCelebrationOverlay } from './OrderCelebrationOverlay';
import { TradeSheet, type TradeSheetMode } from './TradeSheet';
import { InShellContext } from './shellContext';

export type AppShellProps = {
  children: ReactNode;
  /**
   * Show the watchlist rail beside the page (the default). A page with its own side navigation,
   * the guide (NSTOCK-0342), turns it off and gets the full width with no padding at 1024 px and up.
   */
  rail?: boolean;
};

/**
 * Header, left rail and main area (T-024). At 1024 px and up the rail is a sticky column; below
 * that it lives in a left drawer together with the main tabs. "/" focuses search (as does "Search
 * stocks" on an empty list), "?" opens help.
 * The order ticket slide-over (T-135) is mounted here, so it opens over any page, and so is the
 * order-update listener (T-147), so fills refresh the book and toast on any page. From 600 to
 * 1023 px a docked trading panel takes the right of the screen and the page narrows beside it.
 * Below 768 px it is a phone app (NSTOCK-0466): a bottom tab bar in place of the drawer, whose
 * Trade button (and search, wherever it is asked for) opens the trade sheet. A stock's page is
 * pushed over the tabs, so it has its own Buy and Sell bar at the bottom instead.
 */
export function AppShell({ children, rail = true }: AppShellProps) {
  useMarkFirstPaint();
  const drawerOpen = useShellStore((s) => s.drawerOpen);
  // A trading panel docked on a tablet (SPEC-CR-1 §6.2) sits beside the page, not over it.
  const docked = useDockedPanelOpen();
  const helpOpen = useShellStore((s) => s.helpOpen);
  const setDrawerOpen = useShellStore((s) => s.setDrawerOpen);
  const setHelpOpen = useShellStore((s) => s.setHelpOpen);
  const phoneShell = usePhoneShell();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabBar = phoneShell && phoneTabFor(pathname) !== null;
  const [tradeOpen, setTradeOpen] = useState(false);
  // The phone sheet either trades (a pick opens the ticket) or adds to the open watchlist.
  const [sheetMode, setSheetMode] = useState<TradeSheetMode>('trade');
  const openSheet = (mode: TradeSheetMode) => {
    setSheetMode(mode);
    setTradeOpen(true);
  };
  // Only a phone has the trade sheet: one left open closes when the window grows past 767 px.
  const tradeSheetOpen = phoneShell && tradeOpen;
  // Below 1024 px the rail column is hidden, so it is not rendered at all: its watchlist and live
  // quotes cost the phone's first render (Lighthouse TBT on the instrument page). The drawer has its own.
  const narrow = useNarrowScreen();
  const railSearch = useRef<HTMLInputElement>(null);
  const drawerSearch = useRef<HTMLInputElement>(null);

  const focusSearch = (mode: TradeSheetMode = 'trade') => {
    if (phoneShell) {
      openSheet(mode);
      return;
    }
    const input = railSearch.current;
    // offsetParent is null while the rail column is hidden (below 1024 px): use the drawer.
    if (input && input.offsetParent !== null) input.focus();
    else if (drawerOpen) drawerSearch.current?.focus();
    else setDrawerOpen(true);
  };

  // "Search stocks" on an empty orders, positions or holdings list (T-153).
  const searchRequests = useSearchFocusStore((s) => s.requests);
  const handledRequests = useRef(searchRequests);
  useEffect(() => {
    if (searchRequests === handledRequests.current) return;
    handledRequests.current = searchRequests;
    focusSearch();
  });

  // "Add stock" on a watchlist: the rail's search (whose results carry +) or, on a phone, the
  // sheet in its add mode.
  const addRequests = useSearchFocusStore((s) => s.addRequests);
  const handledAdds = useRef(addRequests);
  useEffect(() => {
    if (addRequests === handledAdds.current) return;
    handledAdds.current = addRequests;
    focusSearch('watchlist');
  });

  useShortcut('/', () => focusSearch(), { enabled: !helpOpen && !tradeSheetOpen });
  useShortcut('?', () => setHelpOpen(true), { enabled: !helpOpen });

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-(--nth-z-toast) rounded-md bg-surface px-3 py-2 text-body text-brand focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {strings.skipToContent}
      </a>
      <Header onOpenMenu={() => setDrawerOpen(true)} onOpenHelp={() => setHelpOpen(true)} />
      <div className="flex">
        {/* A phone has no rail: its watchlists are a page under Home, its search the trade sheet. */}
        {rail && !narrow && !phoneShell ? (
          // `hidden lg:block` stays as the fallback where matchMedia is missing.
          <aside
            aria-label={strings.rail.label}
            className="hidden w-80 shrink-0 border-r border-line bg-surface lg:block"
          >
            <div className="sticky top-(--header-h) h-[calc(100dvh-var(--header-h))] overflow-y-auto">
              <LeftRail searchRef={railSearch} onAddStock={() => focusSearch()} />
            </div>
          </aside>
        ) : null}
        <main
          id="main"
          tabIndex={-1}
          data-docked={docked || undefined}
          className={cn(
            'min-w-0 flex-1 p-4 outline-none',
            rail ? 'lg:p-6' : 'lg:p-0',
            docked && 'pr-[calc(var(--nth-dock-w)+1rem)]',
            // Clear of the tab bar and the home indicator, so the last row is never under it.
            tabBar && 'pb-[calc(var(--nth-tabbar-h)+env(safe-area-inset-bottom)+1rem)]',
          )}
        >
          <InShellContext.Provider value={true}>{children}</InShellContext.Provider>
        </main>
      </div>
      {phoneShell ? null : (
        <Sheet
          side="left"
          title={strings.drawer.title}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          initialFocus={drawerSearch}
        >
          <nav aria-label={strings.nav.label} className="border-b border-line p-2">
            <ul className="grid">
              {navItems.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setDrawerOpen(false)}
                    className="flex rounded-md px-3 py-2.5 text-body font-medium text-ink hover:bg-canvas aria-[current=page]:bg-brand-soft aria-[current=page]:text-brand"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <LeftRail
            searchRef={drawerSearch}
            onAddStock={() => drawerSearch.current?.focus()}
            onNavigate={() => setDrawerOpen(false)}
          />
        </Sheet>
      )}
      {tabBar ? <BottomTabBar onTrade={() => openSheet('trade')} /> : null}
      {phoneShell ? (
        <TradeSheet open={tradeSheetOpen} onOpenChange={setTradeOpen} mode={sheetMode} />
      ) : null}
      <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <OrderTicketHost />
      <OrderCelebrationOverlay />
      <TrailingStopSheetHost />
      <PositionEditorHost />
      <OrderUpdatesBridge />
      <NotificationsBridge />
      <TradingIntentTimeouts />
      <TrailingStopAnnouncer />
    </div>
  );
}
