import { cn } from '@nthstock/ui';
import type { IPriceLine } from 'lightweight-charts';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ChartHandle } from '@/features/charts';
import { panBy } from '../lib/panChart';
import { syncPriceLines } from '../lib/priceLines';
import { RepaintPrimitive } from '../lib/repaintPrimitive';
import {
  DRAG_SLOP,
  IDLE,
  cancel,
  move,
  press,
  release,
  type GestureEffect,
  type HandleGesture,
} from '../model/handleGesture';
import { byPriority, type LineAction, type OverlayLine } from '../model/overlayLine';
import { layoutHandles, snapToTick } from '../model/overlayLayout';

export type ChartOverlayProps = {
  handle: ChartHandle;
  /** The lines to draw, each at its current (or pending) price. */
  lines: readonly OverlayLine[];
  /** The instrument's tick in paise; every price from the chart snaps to it. */
  tickSize: number;
  /** Accessible name of the group of handles, e.g. "Chart orders for INFY". */
  label: string;
  /** A tap on an empty part of the price gutter, at that (snapped) price. */
  onGutterTap?: ((price: number) => void) | undefined;
  /** A handle is being moved to `price` (pointer or arrow keys). */
  onDragMove?: ((id: string, price: number) => void) | undefined;
  /** The move ended: saved at `price`, or cancelled (null) so the line goes back. */
  onDragEnd?: ((id: string, price: number | null) => void) | undefined;
  /** A tap on a handle that did not move. */
  onHandleTap?: ((id: string) => void) | undefined;
  /** Delete or Backspace on a focused handle. */
  onHandleDelete?: ((id: string) => void) | undefined;
  /** One of the line's action buttons (× on an order, Buy or Sell on the ghost) was pressed. */
  onAction?: ((id: string, action: string) => void) | undefined;
};

type Elements = {
  rows: Map<string, HTMLElement>;
  handles: Map<string, HTMLElement>;
  leaders: Map<string, HTMLElement>;
  gutter: HTMLElement | null;
  layer: HTMLElement | null;
};
type Drawn = Map<string, { line: IPriceLine; price: number; tone: OverlayLine['tone'] }>;
type KeyMove = { id: string; price: number } | null;
/** A press on a handle that does not move a price: a tap, or a pan once it moves (§9.1). */
type ChipPress = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  panning: boolean;
};

/**
 * The trading layer over the price chart (T15, SPEC-TFC-1 §8, §9, §10.5). Lines are the library's
 * price lines; each has a DOM handle (a real button with a text label) beside the price axis, and
 * the price axis itself is the gutter you tap to start an order.
 *
 * Handles are positioned on every chart repaint by a series primitive, writing styles directly,
 * so pan, pinch, autoscale and live ticks never cause a React render. React renders only when the
 * lines themselves change. Handles that would overlap are spread with leader lines, and a line
 * off the visible range pins its handle to the edge with an arrow.
 */
export function ChartOverlay({
  handle,
  lines,
  tickSize,
  label,
  onGutterTap,
  onDragMove,
  onDragEnd,
  onHandleTap,
  onHandleDelete,
  onAction,
}: ChartOverlayProps) {
  const ordered = byPriority(lines);
  const describedBy = useId();
  const elementsRef = useRef<Elements>({
    rows: new Map(),
    handles: new Map(),
    leaders: new Map(),
    gutter: null,
    layer: null,
  });
  const drawnRef = useRef<Drawn>(new Map());
  const gestureRef = useRef<HandleGesture>(IDLE);
  const keyMoveRef = useRef<KeyMove>(null);
  const gutterPressRef = useRef<{ pointerId: number; y: number } | null>(null);
  const chipRef = useRef<ChipPress | null>(null);
  const primitiveRef = useRef<RepaintPrimitive | null>(null);
  // The latest lines and callbacks, for the repaint hook and the event handlers.
  const latestRef = useRef({
    lines: ordered,
    on: { onGutterTap, onDragMove, onDragEnd, onHandleTap, onHandleDelete, onAction },
  });

  const apply = (step: { gesture: HandleGesture; effect: GestureEffect }) => {
    gestureRef.current = step.gesture;
    const { effect } = step;
    const { on } = latestRef.current;
    if (effect.kind === 'move') on.onDragMove?.(effect.id, effect.price);
    else if (effect.kind === 'commit') on.onDragEnd?.(effect.id, effect.price);
    else if (effect.kind === 'cancel') on.onDragEnd?.(effect.id, null);
    else if (effect.kind === 'tap') on.onHandleTap?.(effect.id);
  };

  // One primitive per chart: its repaint hook is the only per-frame work the overlay does.
  useLayoutEffect(() => {
    const { series } = handle;
    const primitive = new RepaintPrimitive(() =>
      placeHandles(handle, latestRef.current.lines, elementsRef.current),
    );
    primitiveRef.current = primitive;
    series.attachPrimitive(primitive);
    const drawn = drawnRef.current;
    return () => {
      series.detachPrimitive(primitive);
      for (const { line } of drawn.values()) series.removePriceLine(line);
      drawn.clear();
      primitiveRef.current = null;
    };
  }, [handle]);

  // New lines: draw them, place their handles now, and repaint so the canvas agrees.
  useLayoutEffect(() => {
    latestRef.current = {
      lines: ordered,
      on: { onGutterTap, onDragMove, onDragEnd, onHandleTap, onHandleDelete, onAction },
    };
    syncPriceLines(handle.series, drawnRef.current, ordered);
    placeHandles(handle, ordered, elementsRef.current);
    primitiveRef.current?.requestUpdate();
    // A line that went away mid-drag (filled or cancelled) ends the drag; the caller restores it.
    const active = gestureRef.current;
    if (active.phase !== 'idle' && !ordered.some((line) => line.id === active.id)) {
      apply(cancel(active));
    }
  });

  // A second finger anywhere cancels a drag (§9.1).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const active = gestureRef.current;
      if (active.phase === 'idle' || event.pointerId === active.pointerId) return;
      gestureRef.current = IDLE;
      if (active.phase === 'dragging') latestRef.current.on.onDragEnd?.(active.id, null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const paneY = (clientY: number) => clientY - handle.host.getBoundingClientRect().top;
  const priceAt = (y: number) => {
    const price = handle.series.coordinateToPrice(y);
    return price === null ? null : snapToTick(price, tickSize);
  };

  const onHandlePointerDown = (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const line = latestRef.current.lines.find((candidate) => candidate.id === id);
    if (line && !line.draggable) {
      // The position chip: a tap opens it, a drag pans the chart (§9.1).
      if (gestureRef.current.phase !== 'idle' || chipRef.current) return;
      const { pointerId, clientX: x, clientY: y } = event;
      chipRef.current = { id, pointerId, startX: x, startY: y, x, panning: false };
      return;
    }
    apply(press(gestureRef.current, id, event.pointerId, paneY(event.clientY)));
  };
  const onHandlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const chip = chipRef.current;
    if (chip) {
      if (chip.pointerId !== event.pointerId) return;
      if (
        !chip.panning &&
        Math.max(Math.abs(event.clientX - chip.startX), Math.abs(event.clientY - chip.startY)) >
          DRAG_SLOP
      ) {
        chip.panning = true;
      }
      if (chip.panning) panBy(handle.chart, event.clientX - chip.x);
      chip.x = event.clientX;
      return;
    }
    apply(move(gestureRef.current, event.pointerId, paneY(event.clientY), priceAt));
  };
  const onHandlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const chip = chipRef.current;
    if (chip) {
      if (chip.pointerId !== event.pointerId) return;
      chipRef.current = null;
      if (!chip.panning) latestRef.current.on.onHandleTap?.(chip.id);
      return;
    }
    apply(release(gestureRef.current, event.pointerId, paneY(event.clientY)));
  };
  const onHandlePointerCancel = () => {
    chipRef.current = null;
    apply(cancel(gestureRef.current));
  };

  // Keyboard (§13): arrows move one tick, Shift ten; Enter saves; Escape restores.
  const onHandleKeyDown = (line: OverlayLine) => (event: KeyboardEvent<HTMLElement>) => {
    const { on } = latestRef.current;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      on.onHandleDelete?.(line.id);
      return;
    }
    const current = keyMoveRef.current?.id === line.id ? keyMoveRef.current : null;
    if (event.key === 'Escape' && current) {
      event.preventDefault();
      event.stopPropagation();
      keyMoveRef.current = null;
      on.onDragEnd?.(line.id, null);
      return;
    }
    if (event.key === 'Enter' && current) {
      event.preventDefault();
      keyMoveRef.current = null;
      on.onDragEnd?.(line.id, current.price);
      return;
    }
    if (!line.draggable && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      on.onHandleTap?.(line.id);
      return;
    }
    if (!line.draggable || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const steps = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    const price = snapToTick((current?.price ?? line.price) + steps * tickSize, tickSize);
    keyMoveRef.current = { id: line.id, price };
    on.onDragMove?.(line.id, price);
  };
  const onHandleBlur = (line: OverlayLine) => () => {
    if (keyMoveRef.current?.id !== line.id) return;
    keyMoveRef.current = null;
    latestRef.current.on.onDragEnd?.(line.id, null);
  };

  const onGutterPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gutterPressRef.current = { pointerId: event.pointerId, y: paneY(event.clientY) };
  };
  const onGutterPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gutterPressRef.current;
    gutterPressRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const y = paneY(event.clientY);
    if (Math.abs(y - start.y) > DRAG_SLOP) return;
    const price = priceAt(y);
    if (price !== null) latestRef.current.on.onGutterTap?.(price);
  };

  const refFor =
    (kind: 'rows' | 'handles' | 'leaders', id: string) =>
    (element: HTMLElement | null): void => {
      const map = elementsRef.current[kind];
      if (element) map.set(id, element);
      else map.delete(id);
    };

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="chart-overlay"
    >
      {/* The price axis is the gutter: tap to start an order there (§8.2). */}
      <div
        ref={(element) => {
          elementsRef.current.gutter = element;
        }}
        aria-hidden="true"
        data-testid="chart-gutter"
        className="pointer-events-auto absolute top-0 right-0 cursor-crosshair touch-none select-none [-webkit-touch-callout:none]"
        onPointerDown={onGutterPointerDown}
        onPointerUp={onGutterPointerUp}
        onPointerCancel={() => (gutterPressRef.current = null)}
      />
      <div
        ref={(element) => {
          elementsRef.current.layer = element;
        }}
        role="group"
        aria-label={label}
        className="absolute top-0 left-0"
      >
        {ordered.map((line) => (
          <div key={line.id}>
            <span id={`${describedBy}-${line.id}`} hidden>
              {line.description}
            </span>
            <span
              ref={refFor('leaders', line.id)}
              aria-hidden="true"
              hidden
              className="absolute right-2 w-px bg-ink-muted"
            />
            <div
              ref={refFor('rows', line.id)}
              className="absolute top-0 right-0 flex items-center gap-1"
            >
              <button
                ref={refFor('handles', line.id)}
                type="button"
                // The name is the visible label (WCAG 2.5.3); what the keys do is the description.
                aria-label={line.label}
                aria-describedby={`${describedBy}-${line.id}`}
                data-testid="chart-handle"
                data-line={line.id}
                data-tone={line.tone}
                className={cn(
                  'group pointer-events-auto flex min-h-11 touch-none items-center select-none [-webkit-touch-callout:none]',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
                  line.draggable ? 'cursor-ns-resize' : 'cursor-pointer',
                )}
                onPointerDown={onHandlePointerDown(line.id)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerCancel}
                onLostPointerCapture={onHandlePointerCancel}
                onKeyDown={onHandleKeyDown(line)}
                onBlur={onHandleBlur(line)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex items-center gap-1 rounded-sm border px-2 py-0.5 text-label whitespace-nowrap shadow-sm',
                    TONE_CLASSES[line.tone],
                  )}
                >
                  <span className="hidden group-data-[pinned=top]:inline">↑</span>
                  <span className="hidden group-data-[pinned=bottom]:inline">↓</span>
                  {line.label}
                </span>
              </button>
              {line.actions?.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  aria-label={action.description}
                  data-testid="chart-handle-action"
                  data-action={action.id}
                  data-armed={action.look === 'armed' ? 'true' : 'false'}
                  className={cn(
                    'pointer-events-auto grid min-h-11 min-w-11 place-items-center rounded-sm px-2 text-label font-medium shadow-sm',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
                    ACTION_CLASSES[action.look],
                  )}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => latestRef.current.on.onAction?.(line.id, action.id)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Moves every handle, leader line and the gutter to the chart's current coordinates. */
function placeHandles(
  { chart, series }: ChartHandle,
  lines: readonly OverlayLine[],
  { rows, handles, leaders, gutter, layer }: Elements,
): void {
  const height = chart.paneSize(0).height;
  const axisWidth = chart.priceScale('right').width();
  if (gutter) {
    gutter.style.width = `${String(axisWidth)}px`;
    gutter.style.height = `${String(height)}px`;
  }
  if (layer) {
    layer.style.right = `${String(axisWidth)}px`;
    layer.style.height = `${String(height)}px`;
  }
  const layout = layoutHandles(lines, (price) => series.priceToCoordinate(price), { height });
  for (const place of layout) {
    const row = rows.get(place.id);
    if (row) {
      row.style.transform = `translateY(${String(Math.round(place.labelY))}px) translateY(-50%)`;
    }
    const element = handles.get(place.id);
    if (element) {
      element.dataset.pinned = place.pinned ?? '';
      element.dataset.y = String(Math.round(place.labelY));
    }
    const leader = leaders.get(place.id);
    if (leader) {
      const offset = place.lineY === null ? 0 : Math.abs(place.labelY - place.lineY);
      leader.hidden = offset < 2;
      if (place.lineY !== null && offset >= 2) {
        leader.style.top = `${String(Math.round(Math.min(place.lineY, place.labelY)))}px`;
        leader.style.height = `${String(Math.round(offset))}px`;
      }
    }
  }
}

const TONE_CLASSES: Record<OverlayLine['tone'], string> = {
  buy: 'border-brand bg-brand text-surface',
  sell: 'border-down bg-down text-surface',
  ghost: 'border-dashed border-ink-muted bg-surface text-ink',
  position: 'border-ink bg-surface text-ink',
  trailing: 'border-dashed border-ink bg-marigold text-ink',
  pending: 'border-dotted border-ink-muted bg-surface text-ink-muted',
};

const ACTION_CLASSES: Record<LineAction['look'], string> = {
  plain: 'border border-line bg-surface text-ink',
  armed: 'bg-down text-surface',
  buy: 'bg-brand text-surface',
  sell: 'bg-down text-surface',
};
