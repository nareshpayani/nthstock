import { createFileRoute } from '@tanstack/react-router';
import { WatchlistPage } from '@/features/watchlist';

// The phone app's Watchlist view (NSTOCK-0466), beside Market under the Home tab.
export const Route = createFileRoute('/_app/watchlist')({
  component: WatchlistPage,
});
