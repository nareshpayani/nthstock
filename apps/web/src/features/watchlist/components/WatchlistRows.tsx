import type { OrderSide, Quote, WatchlistItem } from '@nthstock/contracts';
import { quoteKey } from '@nthstock/apiClient';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isTypingTarget } from '@/shared/hooks/useShortcut';
import { usePointerReorder } from '../hooks/usePointerReorder';
import { ROW_HEIGHT, WatchlistRow } from './WatchlistRow';

/** Rows shown before the list scrolls; with 50 stocks at most, the rest are virtualised. */
export const VISIBLE_ROWS = 8;
const OVERSCAN = 2;
/** Near the top or bottom edge a drag scrolls the list by this much per move. */
const EDGE_PX = 24;

export type WatchlistRowsProps = {
  label: string;
  items: readonly WatchlistItem[];
  snapshot: ReadonlyMap<string, Quote>;
  /** Custom order: drag and Alt+↑/↓ move rows. Otherwise Alt+↑/↓ calls `onReorderBlocked`. */
  reorderable: boolean;
  /** Move the stock at `from` to `to` (indexes into `items`). */
  onReorder: (from: number, to: number) => void;
  onReorderBlocked: () => void;
  onTrade: (item: WatchlistItem, side: OrderSide) => void;
  onRemove: (item: WatchlistItem) => void;
};

/**
 * The open list's stocks on TanStack Virtual (T-119). Only rows in view (plus a small overscan) are
 * mounted, and only mounted rows subscribe to live quotes: a row scrolled away unmounts its price
 * cells, and the quote store unsubscribes the symbol when its last cell goes (T-124).
 *
 * Keyboard: one tab stop; ↑/↓, Home and End move between rows, Enter opens the stock, B and S open
 * the order ticket, Delete removes, Alt+↑/↓ moves the row (T-122, T-125). The focused row stays
 * mounted while focus is in the list, so scrolling never drops focus.
 */
export function WatchlistRows({
  label,
  items,
  snapshot,
  reorderable,
  onReorder,
  onReorderBlocked,
  onTrade,
  onRemove,
}: WatchlistRowsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeToken, setActiveToken] = useState<number | null>(null);
  const [focusInside, setFocusInside] = useState(false);
  const focusPending = useRef<number | null>(null);

  const found = items.findIndex((item) => item.token === activeToken);
  const activeIndex = found >= 0 ? found : 0;
  const keep = focusInside ? activeIndex : null;

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (keep === null || keep >= range.count || indexes.includes(keep)) return indexes;
      return [...indexes, keep].sort((a, b) => a - b);
    },
    [keep],
  );

  // TanStack Virtual returns fresh functions each render; the React Compiler lint knows this.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => items[index]?.token ?? index,
    rangeExtractor,
  });
  const rows = virtualizer.getVirtualItems();
  const tabbableIndex = rows.some((row) => row.index === activeIndex)
    ? activeIndex
    : (rows[0]?.index ?? 0);

  useEffect(() => {
    const token = focusPending.current;
    if (token === null) return;
    const index = items.findIndex((item) => item.token === token);
    const link = scrollRef.current?.querySelector<HTMLElement>(
      `[data-index="${String(index)}"] a[href]`,
    );
    if (link) {
      focusPending.current = null;
      link.focus({ preventScroll: true });
    }
  });

  const focusRow = (index: number) => {
    const item = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!item) return;
    focusPending.current = item.token;
    setActiveToken(item.token);
    virtualizer.scrollToIndex(items.indexOf(item), { align: 'auto' });
  };

  const move = (from: number, to: number) => {
    const item = items[from];
    if (!item || to < 0 || to >= items.length || to === from) return;
    focusPending.current = item.token;
    onReorder(from, to);
    virtualizer.scrollToIndex(to, { align: 'auto' });
  };

  const { drag, handleProps } = usePointerReorder({
    axis: 'y',
    count: items.length,
    measure: () => (index) => index * ROW_HEIGHT + ROW_HEIGHT / 2,
    position: (event) => {
      const box = scrollRef.current?.getBoundingClientRect();
      return event.clientY - (box?.top ?? 0) + (scrollRef.current?.scrollTop ?? 0);
    },
    onDragMove: (event) => {
      const element = scrollRef.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      if (event.clientY < box.top + EDGE_PX) element.scrollTop -= ROW_HEIGHT / 2;
      else if (event.clientY > box.bottom - EDGE_PX) element.scrollTop += ROW_HEIGHT / 2;
    },
    onDrop: (from, to) => {
      const item = items[from];
      if (item) setActiveToken(item.token);
      onReorder(from, to);
    },
  });

  const onRowKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, item: WatchlistItem) => {
    if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey) return;
    const index = items.indexOf(item);
    const key = event.key;
    if (event.altKey) {
      if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
      event.preventDefault();
      if (!reorderable) onReorderBlocked();
      else move(index, key === 'ArrowUp' ? index - 1 : index + 1);
      return;
    }
    const lower = key.toLowerCase();
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault();
      const target = {
        ArrowDown: index + 1,
        ArrowUp: index - 1,
        Home: 0,
        End: items.length - 1,
      }[key];
      focusRow(target);
    } else if ((lower === 'b' || lower === 's') && !event.shiftKey) {
      event.preventDefault();
      onTrade(item, lower === 'b' ? 'BUY' : 'SELL');
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      // Focus the row that takes its place (or the new last row).
      const next = items[index + 1] ?? items[index - 1];
      if (next) {
        focusPending.current = next.token;
        setActiveToken(next.token);
      }
      onRemove(item);
    }
  };

  const onRowFocus = useCallback((item: WatchlistItem) => setActiveToken(item.token), []);

  const height = Math.min(items.length, VISIBLE_ROWS) * ROW_HEIGHT;
  return (
    <div
      ref={scrollRef}
      className="relative overflow-y-auto overscroll-contain"
      style={{ height }}
      onFocus={() => setFocusInside(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusInside(false);
        }
      }}
    >
      <ul aria-label={label} className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => {
          const item = items[row.index];
          if (!item) return null;
          const dragging = drag?.from === row.index;
          const offset = dragging ? drag.offset : 0;
          return (
            <li
              key={row.key}
              data-index={row.index}
              aria-posinset={row.index + 1}
              aria-setsize={items.length}
              className="absolute top-0 left-0 w-full"
              style={{
                height: ROW_HEIGHT,
                transform: `translateY(${String(row.start + offset)}px)`,
              }}
            >
              <WatchlistRow
                item={item}
                snapshot={snapshot.get(quoteKey(item.symbol, item.exchange))}
                tabbable={row.index === tabbableIndex}
                reorderable={reorderable}
                dragging={dragging}
                handleProps={handleProps(row.index)}
                onRowKeyDown={onRowKeyDown}
                onRowFocus={onRowFocus}
                onTrade={onTrade}
                onRemove={onRemove}
              />
            </li>
          );
        })}
      </ul>
      {drag && drag.to !== drag.from ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 h-0.5 rounded-pill bg-brand"
          style={{
            top: (drag.to > drag.from ? drag.to + 1 : drag.to) * ROW_HEIGHT - 1,
          }}
        />
      ) : null}
    </div>
  );
}
