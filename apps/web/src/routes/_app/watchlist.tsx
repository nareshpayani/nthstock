import { createFileRoute } from '@tanstack/react-router';
import { WatchlistSection, WatchlistSortMenu } from '@/features/watchlist';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';

// The phone app's Watchlist view (NSTOCK-0466), beside Market under the Home tab: on a phone there
// is no rail, so the watchlists get a page of their own. "Add stock" opens search (the trade sheet
// on a phone, the rail's box on a desktop).
export const Route = createFileRoute('/_app/watchlist')({
  component: WatchlistRoute,
});

function WatchlistRoute() {
  const requestSearch = useSearchFocusStore((s) => s.requestSearch);
  return (
    <div className="mx-auto grid w-full max-w-xl gap-3">
      <div className="flex items-center justify-between gap-2">
        {/* The top bar's switch names the page on a phone. */}
        <h1 className="text-title text-ink max-[767px]:sr-only">Watchlist</h1>
        <WatchlistSortMenu />
      </div>
      <WatchlistSection onAddStock={requestSearch} />
    </div>
  );
}
