import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type Key,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';

export type VirtualListProps<T> = {
  items: readonly T[];
  /** Accessible name of the grid, e.g. "All stocks". */
  label: string;
  /** Fixed row height in px. */
  rowHeight: number;
  /** Height of the scroll area (px or any CSS length). */
  height: number | string;
  /** CSS grid-template-columns shared by the header and every row. */
  columns: string;
  /** Column headers, rendered in a sticky header row. */
  header?: ReactNode;
  /** Cells for one row; wrap each in <VirtualCell>. */
  renderRow: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => Key;
  /** Enter on the focused row. */
  onRowActivate?: (item: T, index: number) => void;
  overscan?: number;
  className?: string;
};

export function VirtualCell({
  className,
  numeric,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { numeric?: boolean }) {
  return (
    <div
      role="gridcell"
      className={cn('truncate px-3', numeric && 'text-right font-mono tabular-nums', className)}
      {...rest}
    />
  );
}

export function VirtualHeaderCell({
  className,
  numeric,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { numeric?: boolean }) {
  return (
    <div
      role="columnheader"
      className={cn(
        'truncate px-3 text-label font-semibold text-ink-muted',
        numeric && 'text-right',
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Long lists (5,000 instruments) on TanStack Virtual: only visible rows are in the DOM, the header
 * sticks, and ↑/↓/Home/End move a roving row focus (one tab stop for the whole list).
 */
export function VirtualList<T>({
  items,
  label,
  rowHeight,
  height,
  columns,
  header,
  renderRow,
  getKey,
  onRowActivate,
  overscan = 6,
  className,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const focusPending = useRef(false);
  const headerOffset = header ? rowHeight : 0;

  // TanStack Virtual returns fresh functions each render; the React Compiler lint knows this.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    scrollPaddingStart: headerOffset,
    ...(getKey ? { getItemKey: (index: number) => getKey(items[index] as T, index) } : {}),
  });

  useEffect(() => {
    if (!focusPending.current) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`);
    if (row) {
      row.focus({ preventScroll: true });
      focusPending.current = false;
    }
  });

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    focusPending.current = true;
    setActive(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(
      1,
      Math.floor((scrollRef.current?.clientHeight ?? rowHeight) / rowHeight) - 1,
    );
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: items.length - 1,
      PageDown: active + page,
      PageUp: active - page,
    };
    const target = moves[event.key];
    if (target !== undefined) {
      event.preventDefault();
      moveTo(target);
    } else if (event.key === 'Enter' && onRowActivate && items[active] !== undefined) {
      onRowActivate(items[active], active);
    }
  };

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={items.length + (header ? 1 : 0)}
      onKeyDown={onKeyDown}
      className={cn('relative overflow-auto rounded-md border border-line bg-surface', className)}
      style={{ height }}
    >
      {header ? (
        <div role="rowgroup" className="sticky top-0 z-1 border-b border-line bg-surface">
          <div
            role="row"
            aria-rowindex={1}
            className="grid items-center"
            style={{ gridTemplateColumns: columns, height: rowHeight }}
          >
            {header}
          </div>
        </div>
      ) : null}
      <div
        role="rowgroup"
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index] as T;
          return (
            <div
              key={row.key}
              role="row"
              data-index={row.index}
              aria-rowindex={row.index + 1 + (header ? 1 : 0)}
              aria-selected={row.index === active}
              tabIndex={row.index === active ? 0 : -1}
              onClick={() => setActive(row.index)}
              className="absolute top-0 left-0 grid w-full items-center border-b border-line text-body text-ink outline-none hover:bg-canvas focus-visible:bg-brand-soft focus-visible:shadow-[inset_3px_0_0_var(--nth-color-brand)]"
              style={{
                gridTemplateColumns: columns,
                height: row.size,
                transform: `translateY(${String(row.start)}px)`,
              }}
            >
              {renderRow(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
