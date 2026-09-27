import {
  EmptyState,
  ErrorState,
  IconBookmark,
  IconChevronDown,
  Tabs,
  TabsContent,
  buttonVariants,
  cn,
} from '@nthstock/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { Suspense, lazy, useId, useState } from 'react';
import { SkeletonRows } from '@/shared/components/SkeletonRows';
import { useSession } from '@/shared/hooks/useSession';
import { safeStorage } from '@/shared/lib/safeStorage';
import { useActiveWatchlist } from '../hooks/useActiveWatchlist';
import { useReorderWatchlists } from '../hooks/useWatchlistMutations';
import { moveItem } from '../model/sortItems';
import { useWatchlistUiStore } from '../store/watchlistUiStore';
import { strings } from '../strings';
import type { WatchlistDialogState } from './WatchlistDialogs';
import { WatchlistPanel } from './WatchlistPanel';
import { WatchlistTabs } from './WatchlistTabs';

export const COLLAPSED_KEY = 'nth.watchlist.collapsed';

// The dialogs load on first use, keeping React Hook Form out of the initial JS (the rail is in
// the shell on every page).
const WatchlistDialogs = lazy(() =>
  import('./WatchlistDialogs').then((module) => ({ default: module.WatchlistDialogs })),
);

export type WatchlistSectionProps = {
  /** Called by "Add stock"; the shell focuses the search box. */
  onAddStock: () => void;
};

/**
 * "Watchlists" in the left rail (T-119): one tab per named list and the open list's live rows.
 * Logged out, it invites the user to log in. The section collapses, remembered in localStorage;
 * the rail still renders when storage throws (T-027). Changes are announced in a polite live
 * region (T-122).
 */
export function WatchlistSection({ onAddStock }: WatchlistSectionProps) {
  const [collapsed, setCollapsed] = useState(() => safeStorage.get(COLLAPSED_KEY) === '1');
  const [dialog, setDialog] = useState<WatchlistDialogState | null>(null);
  const panelId = useId();
  const { status } = useSession();
  const { query, lists, active } = useActiveWatchlist();
  const setActiveList = useWatchlistUiStore((s) => s.setActiveList);
  const announcement = useWatchlistUiStore((s) => s.announcement);
  const announce = useWatchlistUiStore((s) => s.announce);
  const { mutate: reorderLists } = useReorderWatchlists();
  const here = useRouterState({ select: (s) => s.location.href });

  const toggle = () => {
    setCollapsed((current) => {
      safeStorage.set(COLLAPSED_KEY, current ? '0' : '1');
      return !current;
    });
  };

  const onReorderLists = (from: number, to: number) => {
    const list = lists[from];
    if (!list || to < 0 || to >= lists.length || to === from) return;
    reorderLists({ ids: moveItem(lists, from, to).map((l) => l.id) });
    announce(strings.announce.moved(list.name, to + 1, lists.length));
  };

  let body;
  if (status === 'anonymous') {
    body = (
      <EmptyState
        title={strings.signedOut.title}
        description={strings.signedOut.body}
        action={
          <Link
            to="/login"
            search={{ redirect: here }}
            aria-label={strings.signedOut.loginLabel}
            className={buttonVariants({ size: 'sm' })}
          >
            {strings.signedOut.login}
          </Link>
        }
      />
    );
  } else if (active) {
    body = (
      <Tabs
        value={active.id}
        onValueChange={(id) => {
          const list = lists.find((l) => l.id === id);
          if (list) setActiveList({ id: list.id, name: list.name });
        }}
      >
        <WatchlistTabs
          lists={lists}
          active={active}
          onReorder={onReorderLists}
          onCreate={() => setDialog({ kind: 'create' })}
          onRename={(list) => setDialog({ kind: 'rename', list })}
          onDelete={(list) => setDialog({ kind: 'delete', list })}
        />
        {lists.map((list) => (
          <TabsContent key={list.id} value={list.id} className="pt-0">
            {list.id === active.id ? <WatchlistPanel list={list} onAddStock={onAddStock} /> : null}
          </TabsContent>
        ))}
      </Tabs>
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        title={strings.loadError.title}
        description={strings.loadError.body}
        retryLabel={strings.loadError.retry}
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    body = (
      <div className="px-4 py-2">
        <SkeletonRows count={3} label={strings.loading} />
      </div>
    );
  }

  return (
    <section aria-label={strings.title} className="rounded-lg border border-line bg-surface">
      <h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          onClick={toggle}
          className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left hover:bg-canvas"
        >
          <IconBookmark size={18} className="text-brand" />
          <span className="flex-1 text-body font-semibold text-ink">{strings.title}</span>
          {active && status === 'authenticated' ? (
            <span className="text-label text-ink-muted">{strings.count(active.items.length)}</span>
          ) : null}
          <IconChevronDown
            size={18}
            className={cn('text-ink-muted transition-transform', collapsed && '-rotate-90')}
          />
        </button>
      </h2>
      <div id={panelId} hidden={collapsed} className="border-t border-line">
        {body}
      </div>
      <p role="status" className="sr-only">
        {announcement.text}
        {/* A no-break space on every other message, so the same words twice are read twice. */}
        {announcement.seq % 2 === 1 ? ' ' : ''}
      </p>
      {dialog ? (
        <Suspense fallback={null}>
          <WatchlistDialogs
            dialog={dialog}
            lists={lists}
            onClose={() => setDialog(null)}
            onCreated={(name) => setActiveList({ id: null, name })}
            announce={announce}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
