import type { OrderSide, Watchlist, WatchlistItem } from '@nthstock/contracts';
import { Button, EmptyState, IconPlus } from '@nthstock/ui';
import { useCallback } from 'react';
import { useKeepLive } from '@/shared/hooks/useKeepLive';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { useListQuotes } from '../hooks/useListQuotes';
import { RESORT_MS, useSortedItems } from '../hooks/useSortedItems';
import { useRemoveFromWatchlist, useReorderWatchlistItems } from '../hooks/useWatchlistMutations';
import { moveItem } from '../model/sortItems';
import { useWatchlistUiStore } from '../store/watchlistUiStore';
import { strings } from '../strings';
import { WatchlistRows } from './WatchlistRows';

export type WatchlistPanelProps = {
  list: Watchlist;
  onAddStock: () => void;
};

const symbolsOn = (items: readonly WatchlistItem[], exchange: 'NSE' | 'BSE') =>
  items.filter((item) => item.exchange === exchange).map((item) => item.symbol);

/**
 * The open list (T-119): its rows in the chosen sort, or the empty state. Rows reorder (T-122),
 * remove (T-121) and open the order ticket (T-125). While the tab is hidden, this list's rows stay
 * live and every other price pauses (T-077).
 */
export function WatchlistPanel({ list, onAddStock }: WatchlistPanelProps) {
  const sort = useWatchlistUiStore((s) => s.sort);
  const announce = useWatchlistUiStore((s) => s.announce);
  const byPrice = sort === 'ltp' || sort === 'change';
  const snapshot = useListQuotes(list.items, byPrice ? RESORT_MS : false);
  const items = useSortedItems(list.items, sort, snapshot);
  const { mutate: reorderItems } = useReorderWatchlistItems();
  const { mutate: removeItem } = useRemoveFromWatchlist();
  const openTicket = useOpenTicket();

  useKeepLive(symbolsOn(list.items, 'NSE'), 'NSE');
  useKeepLive(symbolsOn(list.items, 'BSE'), 'BSE');

  const onReorder = (from: number, to: number) => {
    const item = items[from];
    if (!item) return;
    const tokens = moveItem(
      items.map((i) => i.token),
      from,
      to,
    );
    reorderItems({ listId: list.id, tokens });
    announce(strings.announce.moved(item.symbol, to + 1, items.length));
  };

  const onRemove = useCallback(
    (item: WatchlistItem) => {
      removeItem({ listId: list.id, token: item.token, symbol: item.symbol });
      announce(strings.announce.removed(item.symbol, list.name));
    },
    [removeItem, list.id, list.name, announce],
  );

  const onTrade = useCallback(
    (item: WatchlistItem, side: OrderSide) => {
      // The order ticket slide-over (T-135) opens from the intent.
      void openTicket({ symbol: item.symbol, exchange: item.exchange, side });
    },
    [openTicket],
  );

  if (list.items.length === 0) {
    return (
      <EmptyState
        title={strings.emptyTitle}
        description={strings.emptyBody}
        action={
          <Button size="sm" icon={<IconPlus size={16} />} onClick={onAddStock}>
            {strings.addStock}
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid">
      <WatchlistRows
        label={strings.rowsLabel(list.name)}
        items={items}
        snapshot={snapshot}
        reorderable={sort === 'custom'}
        onReorder={onReorder}
        onReorderBlocked={() => announce(strings.announce.sortedOnly)}
        onTrade={onTrade}
        onRemove={onRemove}
      />
      <p className="border-t border-line px-3 py-2 text-label text-ink-muted">
        {strings.row.keyHint}
      </p>
    </div>
  );
}
