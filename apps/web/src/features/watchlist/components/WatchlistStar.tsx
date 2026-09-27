import type { Instrument } from '@nthstock/contracts';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  IconStar,
  cn,
} from '@nthstock/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useSession } from '@/shared/hooks/useSession';
import { useWatchlists } from '../hooks/useWatchlists';
import { useAddToWatchlist, useRemoveFromWatchlist } from '../hooks/useWatchlistMutations';
import { useWatchlistUiStore } from '../store/watchlistUiStore';
import { strings } from '../strings';

export type WatchlistStarProps = {
  instrument: Pick<Instrument, 'token' | 'symbol' | 'exchange' | 'name'>;
};

/**
 * The star on the stock detail page (T-121): filled when the stock is in any watchlist, with a
 * menu of the user's lists to tick or untick. Logged out, it goes to log in and back.
 */
export function WatchlistStar({ instrument }: WatchlistStarProps) {
  const { status } = useSession();
  const { data } = useWatchlists();
  const { mutate: add } = useAddToWatchlist();
  const { mutate: remove } = useRemoveFromWatchlist();
  const announce = useWatchlistUiStore((s) => s.announce);
  const navigate = useNavigate();
  const here = useRouterState({ select: (s) => s.location.href });
  const { token, symbol } = instrument;
  const lists = data?.items ?? [];
  const member = lists.some((list) => list.items.some((i) => i.token === token));
  const label = member ? strings.star.edit(symbol) : strings.star.add(symbol);
  const icon = <IconStar size={20} className={cn(member && 'fill-current')} />;
  const buttonClass = cn(member && 'text-brand');

  if (status !== 'authenticated') {
    return (
      <IconButton
        variant="secondary"
        label={label}
        icon={icon}
        disabled={status === 'unknown'}
        onClick={() => void navigate({ to: '/login', search: { redirect: here } })}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="secondary"
          label={label}
          icon={icon}
          className={buttonClass}
          disabled={lists.length === 0}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{strings.star.menuLabel}</DropdownMenuLabel>
        {lists.map((list) => {
          const checked = list.items.some((i) => i.token === token);
          return (
            <DropdownMenuCheckboxItem
              key={list.id}
              checked={checked}
              // Keep the menu open so several lists can be ticked in one go.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(next) => {
                if (next) {
                  add({ listId: list.id, stock: instrument });
                  announce(strings.announce.added(symbol, list.name));
                } else {
                  remove({ listId: list.id, token, symbol });
                  announce(strings.announce.removed(symbol, list.name));
                }
              }}
            >
              {list.name}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
