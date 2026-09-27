import type { OrderSide, Quote, WatchlistItem } from '@nthstock/contracts';
import { Button, IconButton, IconGrip, IconTrash, cn } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { memo, type HTMLAttributes, type KeyboardEvent, type Ref } from 'react';
import { LiveChange } from '@/shared/components/LiveChange';
import { PriceCell } from '@/shared/components/PriceCell';
import { strings } from '../strings';

/** Fixed row height in px: the virtualiser and the drag maths both rely on it. */
export const ROW_HEIGHT = 56;

export type WatchlistRowProps = {
  item: WatchlistItem;
  /** REST price shown until the first live tick. */
  snapshot: Quote | undefined;
  /** The one row in the tab order (roving tabindex). */
  tabbable: boolean;
  /** Custom order: the drag handle shows. */
  reorderable: boolean;
  dragging: boolean;
  linkRef?: Ref<HTMLAnchorElement>;
  handleProps: HTMLAttributes<HTMLSpanElement>;
  onRowKeyDown: (event: KeyboardEvent<HTMLAnchorElement>, item: WatchlistItem) => void;
  onRowFocus: (item: WatchlistItem) => void;
  onTrade: (item: WatchlistItem, side: OrderSide) => void;
  onRemove: (item: WatchlistItem) => void;
};

/**
 * One watchlist stock (T-119): symbol, exchange, live price and ▲▼ day change. The row is a link to
 * the stock page and the list's single tab stop moves between rows. On hover or focus, B, S and
 * remove appear over the price (T-121, T-125); in custom order a grip on the left drags it (T-122).
 * Memoised: a tick re-renders only its PriceCell and LiveChange, never the row.
 */
export const WatchlistRow = memo(function WatchlistRow({
  item,
  snapshot,
  tabbable,
  reorderable,
  dragging,
  linkRef,
  handleProps,
  onRowKeyDown,
  onRowFocus,
  onTrade,
  onRemove,
}: WatchlistRowProps) {
  const { symbol, exchange } = item;
  const tabIndex = tabbable ? 0 : -1;
  return (
    <div
      className={cn(
        'group relative flex h-full items-center border-b border-line bg-surface',
        dragging && 'z-1 rounded-md shadow-overlay',
      )}
    >
      {reorderable ? (
        // Pointer-only affordance; keyboard users move rows with Alt+↑/↓ on the focused row.
        <span
          {...handleProps}
          aria-hidden="true"
          title={strings.row.dragLabel(symbol)}
          data-drag-handle={symbol}
          className="flex h-full w-5 shrink-0 cursor-grab touch-none items-center justify-center text-ink-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
        >
          <IconGrip size={16} />
        </span>
      ) : null}
      <Link
        ref={linkRef}
        to="/stocks/$symbol"
        params={{ symbol }}
        search={exchange === 'NSE' ? {} : { exchange }}
        tabIndex={tabIndex}
        aria-keyshortcuts="B S Alt+ArrowUp Alt+ArrowDown Delete"
        onKeyDown={(event) => onRowKeyDown(event, item)}
        onFocus={() => onRowFocus(item)}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
          reorderable ? 'pl-1' : 'pl-3',
        )}
      >
        <span className="grid min-w-0 flex-1">
          {/* Spaces between the blocks keep the link's accessible name readable. */}
          <span className="truncate text-body font-semibold text-ink">{symbol}</span>{' '}
          <span className="text-label text-ink-muted">{exchange}</span>{' '}
        </span>
        <span className="grid shrink-0 justify-items-end">
          <PriceCell symbol={symbol} exchange={exchange} size="sm" initial={snapshot?.ltp} />{' '}
          <LiveChange
            symbol={symbol}
            exchange={exchange}
            percentOnly
            initial={
              snapshot ? { change: snapshot.change, changeBp: snapshot.changeBp } : undefined
            }
          />
        </span>
      </Link>
      <div className="absolute inset-y-0 right-2 hidden items-center gap-1 bg-surface pl-2 group-focus-within:flex group-hover:flex">
        <Button
          variant="buy"
          size="sm"
          tabIndex={tabIndex}
          aria-label={strings.row.buyLabel(symbol)}
          onClick={() => onTrade(item, 'BUY')}
          className="w-8 px-0"
        >
          {strings.row.buy}
        </Button>
        <Button
          variant="sell"
          size="sm"
          tabIndex={tabIndex}
          aria-label={strings.row.sellLabel(symbol)}
          onClick={() => onTrade(item, 'SELL')}
          className="w-8 px-0"
        >
          {strings.row.sell}
        </Button>
        <IconButton
          size="sm"
          tabIndex={tabIndex}
          label={strings.row.removeLabel(symbol)}
          icon={<IconTrash size={16} />}
          onClick={() => onRemove(item)}
        />
      </div>
    </div>
  );
});
