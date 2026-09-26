import { SearchBox } from '@/features/search';
import { WatchlistSection, WatchlistSortMenu } from '@/features/watchlist';
import type { Ref } from 'react';
import { strings } from '../strings';

export type LeftRailProps = {
  searchRef: Ref<HTMLInputElement>;
  onAddStock: () => void;
};

/** Left rail frame: search slot, sort slot, "My Watchlist" and a paper-trading note. */
export function LeftRail({ searchRef, onAddStock }: LeftRailProps) {
  return (
    <div className="grid content-start gap-4 p-4">
      <div className="flex items-center gap-2">
        <SearchBox ref={searchRef} />
        <WatchlistSortMenu />
      </div>
      <WatchlistSection onAddStock={onAddStock} />
      <aside className="rounded-lg bg-marigold-soft p-4">
        <p className="text-body font-semibold text-ink">{strings.rail.paperTitle}</p>
        <p className="text-label text-ink">{strings.rail.paperBody}</p>
      </aside>
    </div>
  );
}
