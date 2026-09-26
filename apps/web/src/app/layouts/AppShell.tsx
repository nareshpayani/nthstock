import { Sheet } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { useRef, type ReactNode } from 'react';
import { useShortcut } from '@/shared/hooks/useShortcut';
import { useShellStore } from '../shellStore';
import { strings } from '../strings';
import { Header, type HeaderUser } from './Header';
import { LeftRail } from './LeftRail';
import { navItems } from './navItems';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';

export type AppShellProps = {
  user?: HeaderUser | null;
  children: ReactNode;
};

/**
 * Header, left rail and main area (T-024). At 1024 px and up the rail is a sticky column; below
 * that it lives in a left drawer together with the main tabs. "/" focuses search, "?" opens help.
 */
export function AppShell({ user = null, children }: AppShellProps) {
  const drawerOpen = useShellStore((s) => s.drawerOpen);
  const helpOpen = useShellStore((s) => s.helpOpen);
  const setDrawerOpen = useShellStore((s) => s.setDrawerOpen);
  const setHelpOpen = useShellStore((s) => s.setHelpOpen);
  const railSearch = useRef<HTMLInputElement>(null);
  const drawerSearch = useRef<HTMLInputElement>(null);

  const focusSearch = () => {
    const input = railSearch.current;
    // offsetParent is null while the rail column is hidden (below 1024 px): use the drawer.
    if (input && input.offsetParent !== null) input.focus();
    else if (drawerOpen) drawerSearch.current?.focus();
    else setDrawerOpen(true);
  };

  useShortcut('/', focusSearch, { enabled: !helpOpen });
  useShortcut('?', () => setHelpOpen(true), { enabled: !helpOpen });

  return (
    <div className="min-h-dvh bg-canvas [--header-h:97px] min-[1360px]:[--header-h:57px]">
      <a
        href="#main"
        className="sr-only z-(--nth-z-toast) rounded-md bg-surface px-3 py-2 text-body text-brand focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {strings.skipToContent}
      </a>
      <Header
        user={user}
        onOpenMenu={() => setDrawerOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <div className="flex">
        <aside
          aria-label={strings.rail.label}
          className="hidden w-80 shrink-0 border-r border-line bg-surface lg:block"
        >
          <div className="sticky top-(--header-h) h-[calc(100dvh-var(--header-h))] overflow-y-auto">
            <LeftRail searchRef={railSearch} onAddStock={focusSearch} />
          </div>
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none lg:p-6">
          {children}
        </main>
      </div>
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
        <LeftRail searchRef={drawerSearch} onAddStock={() => drawerSearch.current?.focus()} />
      </Sheet>
      <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
