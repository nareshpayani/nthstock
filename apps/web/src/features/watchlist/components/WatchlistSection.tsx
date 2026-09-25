import { Button, EmptyState, IconBookmark, IconChevronDown, IconPlus, cn } from '@nthstock/ui';
import { useId, useState } from 'react';
import { safeStorage } from '@/shared/lib/safeStorage';
import { strings } from '../strings';

export const COLLAPSED_KEY = 'nth.watchlist.collapsed';

export type WatchlistSectionProps = {
  /** Called by "Add stock"; the shell focuses the search box. */
  onAddStock: () => void;
};

/**
 * Collapsible "My Watchlist" in the left rail. Empty until watchlists arrive (E5); the collapsed
 * state is remembered in localStorage, and the rail still renders when storage throws (T-027).
 */
export function WatchlistSection({ onAddStock }: WatchlistSectionProps) {
  const [collapsed, setCollapsed] = useState(() => safeStorage.get(COLLAPSED_KEY) === '1');
  const panelId = useId();
  const toggle = () => {
    setCollapsed((current) => {
      safeStorage.set(COLLAPSED_KEY, current ? '0' : '1');
      return !current;
    });
  };

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
          <span className="text-label text-ink-muted">{strings.count(0)}</span>
          <IconChevronDown
            size={18}
            className={cn('text-ink-muted transition-transform', collapsed && '-rotate-90')}
          />
        </button>
      </h2>
      <div id={panelId} hidden={collapsed} className="border-t border-line">
        <EmptyState
          title={strings.emptyTitle}
          description={strings.emptyBody}
          action={
            <Button size="sm" icon={<IconPlus size={16} />} onClick={onAddStock}>
              {strings.addStock}
            </Button>
          }
        />
      </div>
    </section>
  );
}
