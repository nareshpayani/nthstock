import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  IconSort,
} from '@nthstock/ui';
import { useSession } from '@/shared/hooks/useSession';
import { WATCHLIST_SORTS, isWatchlistSort } from '../model/sortItems';
import { useWatchlistUiStore } from '../store/watchlistUiStore';
import { strings } from '../strings';

/**
 * Sort menu next to search (T-123): custom (the saved, draggable order), name, last price or
 * % change. Price sorts re-sort every 2 s, not on each tick. Needs a signed-in user's lists.
 */
export function WatchlistSortMenu() {
  const { status } = useSession();
  const sort = useWatchlistUiStore((s) => s.sort);
  const setSort = useWatchlistUiStore((s) => s.setSort);
  const announce = useWatchlistUiStore((s) => s.announce);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`${strings.sortLabel}: ${strings.sort[sort]}`}
          icon={<IconSort size={18} />}
          variant="secondary"
          disabled={status !== 'authenticated'}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{strings.sortBy}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => {
            if (!isWatchlistSort(value)) return;
            setSort(value);
            announce(strings.announce.sorted(strings.sort[value]));
          }}
        >
          {WATCHLIST_SORTS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {strings.sort[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
