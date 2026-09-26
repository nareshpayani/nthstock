import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  IconSort,
} from '@nthstock/ui';
import { strings } from '../strings';

/** Sort slot of the rail. Options are disabled until the watchlist has stocks (E5). */
export function WatchlistSortMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={strings.sortLabel} icon={<IconSort size={18} />} variant="secondary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{strings.sortBy}</DropdownMenuLabel>
        <DropdownMenuItem disabled>{strings.sortName}</DropdownMenuItem>
        <DropdownMenuItem disabled>{strings.sortChange}</DropdownMenuItem>
        <DropdownMenuItem disabled>{strings.sortPrice}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
