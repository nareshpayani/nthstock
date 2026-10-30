import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { strings } from '../strings';
import { WatchlistAddButton } from './WatchlistAddButton';
import { WatchlistSection } from './WatchlistSection';
import { WatchlistSortMenu } from './WatchlistSortMenu';

/**
 * The watchlists as a page (NSTOCK-0466): a phone has no rail, so they sit under Home's Watchlist
 * switch. "Add stock" asks the shell for search (the trade sheet on a phone, the rail's box on a
 * desktop).
 */
export function WatchlistPage() {
  const requestAdd = useSearchFocusStore((s) => s.requestAddToWatchlist);
  return (
    <div className="mx-auto grid w-full max-w-xl gap-3">
      <div className="flex items-center justify-between gap-2">
        {/* The top bar's switch names the page on a phone. */}
        <h1 className="text-title text-ink max-[767px]:sr-only">{strings.pageTitle}</h1>
        {/* Right-aligned like Home's: the page title is visually hidden on a phone. */}
        <div className="ml-auto flex items-center gap-2">
          <WatchlistAddButton />
          <WatchlistSortMenu />
        </div>
      </div>
      <WatchlistSection onAddStock={requestAdd} />
    </div>
  );
}
