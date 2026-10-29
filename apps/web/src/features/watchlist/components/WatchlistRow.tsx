import type { OrderSide, Quote, WatchlistItem } from '@nthstock/contracts';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  IconChevronDown,
  IconChevronUp,
  IconGrip,
  IconMore,
  IconTrash,
  cn,
} from '@nthstock/ui';
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
  /**
   * A touch screen (NSTOCK-0470): hover never happens there, so each row gets a visible actions
   * button in place of the hover buttons and the drag grip.
   */
  touch?: boolean;
  /** Move this row one place up (-1) or down (+1); absent at the list's edge. */
  onMove?: (item: WatchlistItem, delta: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** A sorted list: the menu's reorder item says how to reorder instead. */
  onReorderBlocked?: () => void;
};

/** Menu items are full 44 px touch targets, like the button that opens them. */
const ITEM = 'min-h-11';

/**
 * The touch row's actions (NSTOCK-0470): one 44 px button that opens Buy, Sell, Move up, Move down
 * (custom order only) and Remove, so every action is one visible tap and reordering needs no drag
 * (WCAG 2.5.1, 2.5.7).
 */
function RowActionsMenu({
  item,
  tabIndex,
  reorderable,
  canMoveUp,
  canMoveDown,
  onTrade,
  onRemove,
  onMove,
  onReorderBlocked,
}: {
  item: WatchlistItem;
  tabIndex: number;
  reorderable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onTrade: (item: WatchlistItem, side: OrderSide) => void;
  onRemove: (item: WatchlistItem) => void;
  onMove: ((item: WatchlistItem, delta: -1 | 1) => void) | undefined;
  onReorderBlocked: (() => void) | undefined;
}) {
  const { symbol } = item;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          tabIndex={tabIndex}
          label={strings.row.actionsLabel(symbol)}
          icon={<IconMore size={18} />}
          className="mr-1 size-11 shrink-0"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className={ITEM} onSelect={() => onTrade(item, 'BUY')}>
          {strings.row.buyLabel(symbol)}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={() => onTrade(item, 'SELL')}>
          {strings.row.sellLabel(symbol)}
        </DropdownMenuItem>
        {reorderable && onMove ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={ITEM}
              disabled={!canMoveUp}
              onSelect={() => onMove(item, -1)}
            >
              <IconChevronUp size={16} />{' '}
              {canMoveUp ? strings.row.moveUp : strings.row.firstAlready}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={ITEM}
              disabled={!canMoveDown}
              onSelect={() => onMove(item, 1)}
            >
              <IconChevronDown size={16} />{' '}
              {canMoveDown ? strings.row.moveDown : strings.row.lastAlready}
            </DropdownMenuItem>
          </>
        ) : null}
        {!reorderable && onReorderBlocked ? (
          <>
            <DropdownMenuSeparator />
            {/* Says why there is no Move here: a hint, not an action. */}
            <DropdownMenuItem className={ITEM} disabled>
              {strings.row.reorderHow}
            </DropdownMenuItem>
          </>
        ) : null}
        {/* Extra room above the one destructive item, which colour alone can't mark. */}
        <DropdownMenuSeparator className="my-2" />
        <DropdownMenuItem className={ITEM} onSelect={() => onRemove(item)}>
          <IconTrash size={16} /> {strings.row.removeLabel(symbol)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  touch = false,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
  onReorderBlocked,
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
      {reorderable && !touch ? (
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
          reorderable && !touch ? 'pl-1' : 'pl-3',
          touch && 'pr-2',
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
      {touch ? (
        <RowActionsMenu
          item={item}
          tabIndex={tabIndex}
          reorderable={reorderable}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onTrade={onTrade}
          onRemove={onRemove}
          onMove={onMove}
          onReorderBlocked={onReorderBlocked}
        />
      ) : (
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
      )}
    </div>
  );
});
