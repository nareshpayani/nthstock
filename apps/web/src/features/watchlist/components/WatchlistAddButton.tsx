import { Button, IconPlus } from '@nthstock/ui';
import { useSession } from '@/shared/hooks/useSession';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { useActiveWatchlist } from '../hooks/useActiveWatchlist';
import { strings } from '../strings';

/**
 * "Add stock" above a phone watchlist (NSTOCK-0474): a phone has no rail search, so the add is a
 * button that opens the shell's Add to watchlist sheet. Shown only once the open list has stocks;
 * an empty list has its own Add stock in the empty state.
 */
export function WatchlistAddButton() {
  const requestAdd = useSearchFocusStore((s) => s.requestAddToWatchlist);
  const { status } = useSession();
  const { active } = useActiveWatchlist();
  if (status !== 'authenticated' || !active || active.items.length === 0) return null;
  return (
    <Button
      size="sm"
      icon={<IconPlus size={16} />}
      onClick={requestAdd}
      className="[@media(pointer:coarse)]:min-h-11"
    >
      {strings.addStock}
    </Button>
  );
}
