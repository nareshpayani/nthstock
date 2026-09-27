import { WATCHLIST_MAX_LISTS, type Watchlist } from '@nthstock/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  IconEdit,
  IconMore,
  IconPlus,
  IconTrash,
  TabsList,
  TabsTrigger,
  cn,
} from '@nthstock/ui';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { usePointerReorder } from '../hooks/usePointerReorder';
import { strings } from '../strings';

export type WatchlistTabsProps = {
  lists: readonly Watchlist[];
  active: Watchlist;
  /** Move the list at `from` to `to`. */
  onReorder: (from: number, to: number) => void;
  onCreate: () => void;
  onRename: (list: Watchlist) => void;
  onDelete: (list: Watchlist) => void;
};

const EARLIER = new Set(['ArrowLeft', 'ArrowUp']);
const LATER = new Set(['ArrowRight', 'ArrowDown']);

/**
 * One tab per named list (T-119) inside the Radix Tabs root that WatchlistSection owns, plus New
 * watchlist and the open list's Rename and Delete (T-120). Arrow keys move between tabs (Radix);
 * Alt+arrow moves the focused tab itself, and a tab can be dragged along the row (T-122).
 */
export function WatchlistTabs({
  lists,
  active,
  onReorder,
  onCreate,
  onRename,
  onDelete,
}: WatchlistTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = () => [
    ...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? ([] as HTMLElement[])),
  ];

  // Moving a focused element in the DOM drops its focus, so Alt+arrow puts it back afterwards.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    tabs()
      .find((tab) => tab.dataset.listId === id)
      ?.focus();
  });

  const { drag, handleProps } = usePointerReorder({
    axis: 'x',
    count: lists.length,
    measure: () => {
      const middles = tabs().map((tab) => {
        const box = tab.getBoundingClientRect();
        return box.left + box.width / 2;
      });
      return (index) => middles[index] ?? 0;
    },
    position: (event) => event.clientX,
    onDrop: onReorder,
  });

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const step = EARLIER.has(event.key) ? -1 : LATER.has(event.key) ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    refocus.current = lists[index]?.id ?? null;
    onReorder(index, index + step);
  };

  const full = lists.length >= WATCHLIST_MAX_LISTS;
  const only = lists.length <= 1;
  return (
    <div className="flex items-center gap-1 border-b border-line pr-2">
      <TabsList
        ref={listRef}
        aria-label={strings.tabsLabel}
        className="min-w-0 flex-1 gap-1 border-b-0 px-2"
      >
        {lists.map((list, index) => {
          const drop = handleProps(index);
          const dragged = drag?.from === index;
          return (
            <TabsTrigger
              key={list.id}
              value={list.id}
              data-list-id={list.id}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              onPointerDown={drop.onPointerDown}
              onPointerMove={drop.onPointerMove}
              onPointerUp={drop.onPointerUp}
              onPointerCancel={drop.onPointerCancel}
              onClickCapture={drop.onClickCapture}
              onKeyDown={(event) => {
                drop.onKeyDown(event);
                onTabKeyDown(event, index);
              }}
              className={cn(
                'max-w-40 touch-pan-y truncate px-2 py-2.5',
                dragged && 'relative z-1 rounded-sm bg-surface shadow-overlay',
                drag && !dragged && drag.to === index && 'bg-brand-soft',
              )}
              style={dragged ? { transform: `translateX(${String(drag.offset)}px)` } : undefined}
            >
              {list.name}
            </TabsTrigger>
          );
        })}
      </TabsList>
      <IconButton
        size="sm"
        label={full ? strings.lists.createDisabled : strings.lists.create}
        title={full ? strings.lists.createDisabled : strings.lists.create}
        icon={<IconPlus size={18} />}
        disabled={full}
        onClick={onCreate}
      />
      {/* Not modal: its items open a dialog, which then owns focus and the pointer. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            label={strings.lists.actions(active.name)}
            icon={<IconMore size={18} />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => onRename(active)}>
            <IconEdit size={16} />
            {strings.lists.rename}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={only} onSelect={() => onDelete(active)}>
            <IconTrash size={16} />
            {only ? strings.lists.deleteDisabled : strings.lists.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
