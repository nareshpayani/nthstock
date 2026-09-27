import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { dropIndex } from '../model/dropIndex';

/** Pixels the pointer must travel before a press becomes a drag, so a click stays a click. */
export const DRAG_THRESHOLD_PX = 4;

export type DragState = { from: number; to: number; offset: number };

export type PointerReorderOptions = {
  axis: 'x' | 'y';
  count: number;
  /**
   * Middles of the entries and the pointer, in one coordinate space. `measure` runs when a press
   * starts and `position` on every move, so a scrolling list can add its scroll offset.
   */
  measure: () => (index: number) => number;
  position: (event: PointerEvent<HTMLElement>) => number;
  onDrop: (from: number, to: number) => void;
  /** Called on every move while dragging, e.g. to scroll near an edge. */
  onDragMove?: (event: PointerEvent<HTMLElement>) => void;
};

type Press = {
  pointerId: number;
  start: number;
  startPosition: number;
  middleOf: (index: number) => number;
  drag: DragState | null;
};

/**
 * Drag to reorder with plain pointer events (T-122; no drag-and-drop library). Spread
 * `handleProps(index)` on the drag handle. The handle captures the pointer, the entry follows it
 * by `drag.offset`, `drag.to` is where it would land, and releasing calls `onDrop(from, to)`.
 * Esc cancels. Keyboard users reorder with Alt+↑/↓ instead (see the row and tab key handlers).
 */
export function usePointerReorder(options: PointerReorderOptions) {
  const { axis, count, measure, position, onDrop, onDragMove } = options;
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  /** True right after a drag, so the click that follows the pointerup does not select or open. */
  const suppressClick = useRef(false);

  const finish = (drop: boolean) => {
    const done = press.current?.drag ?? null;
    press.current = null;
    setDrag(null);
    if (!done) return;
    suppressClick.current = true;
    if (drop && done.to !== done.from) onDrop(done.from, done.to);
  };

  const handleProps = (index: number) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || count < 2) return;
      // jsdom has no pointer capture; browsers always do.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      suppressClick.current = false;
      press.current = {
        pointerId: event.pointerId,
        start: axis === 'x' ? event.clientX : event.clientY,
        startPosition: position(event),
        middleOf: measure(),
        drag: null,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const moved = (axis === 'x' ? event.clientX : event.clientY) - current.start;
      if (!current.drag && Math.abs(moved) < DRAG_THRESHOLD_PX) return;
      event.preventDefault();
      onDragMove?.(event);
      const at = position(event);
      current.drag = {
        from: index,
        to: dropIndex(count, index, at, current.middleOf),
        offset: at - current.startPosition,
      };
      setDrag(current.drag);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (press.current?.pointerId === event.pointerId) finish(true);
    },
    onPointerCancel() {
      finish(false);
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key === 'Escape' && press.current?.drag) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    },
  });

  return { drag, handleProps };
}
