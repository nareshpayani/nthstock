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
import { lockChart } from '../lib/chartLock';
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
  bands: Map<string, HTMLElement>;
  handles: Map<string, HTMLElement>;
  leaders: Map<string, HTMLElement>;
  gutter: HTMLElement | null;
  layer: HTMLElement | null;
};
type Drawn = Map<string, { line: IPriceLine; price: number; tone: OverlayLine['tone'] }>;
type KeyMove = { id: string; price: number } | null;
/** Half the grab band's height: a press this close to a draggable line takes it (SPEC-CR-1 §5.1). */
export const BAND_REACH = 22;

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
 *
 * Each draggable line also has an invisible grab band, 44 px tall across the plot, so a press on
 * or near the line takes it, not just a press on its label (SPEC-CR-1 §5.1). From the press until
 * the finger lifts, the drag owns the gesture: the chart's crosshair, scroll and scale are off.
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
    bands: new Map(),
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
  // How far the dragged line sits from the finger at the press (an offset label has a leader line,
  // a band press is beside the line), so the drag moves the price by the finger's movement instead
  // of jumping to where the finger is (§8.4).
  const dragOffsetRef = useRef(0);
  // A press on a band that never moves is not a tap on the line: the plot has nothing to open.
  const fromBandRef = useRef(false);
  // Puts the chart's crosshair, scroll and scale back once the gesture ends (SPEC-CR-1 §5.1).
  const unlockRef = useRef<(() => void) | null>(null);
  const primitiveRef = useRef<RepaintPrimitive | null>(null);
  // The latest lines and callbacks, for the repaint hook and the event handlers.
  const latestRef = useRef({
    lines: ordered,
    on: { onGutterTap, onDragMove, onDragEnd, onHandleTap, onHandleDelete, onAction },
  });

  const unlock = () => {
    unlockRef.current?.();
    unlockRef.current = null;
  };

  const apply = (step: { gesture: HandleGesture; effect: GestureEffect }) => {
    gestureRef.current = step.gesture;
    if (step.gesture.phase === 'idle') unlock();
    const { effect } = step;
    const { on } = latestRef.current;
    if (effect.kind === 'move') on.onDragMove?.(effect.id, effect.price);
    else if (effect.kind === 'commit') on.onDragEnd?.(effect.id, effect.price);
    else if (effect.kind === 'cancel') on.onDragEnd?.(effect.id, null);
    else if (effect.kind === 'tap' && !fromBandRef.current) on.onHandleTap?.(effect.id);
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
      unlockRef.current?.();
      unlockRef.current = null;
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

  // A second finger anywhere, or Escape, cancels what the first finger started (§9.1, T20): a
  // drag restores its line, a press on the chip neither opens it nor keeps panning, and a press
  // on the gutter places no ghost (it was the start of a pinch).
  useEffect(() => {
    const cancelAll = (keep?: number) => {
      const active = gestureRef.current;
      if (active.phase !== 'idle' && active.pointerId !== keep) {
        gestureRef.current = IDLE;
        unlockRef.current?.();
        unlockRef.current = null;
        if (active.phase === 'dragging') latestRef.current.on.onDragEnd?.(active.id, null);
      }
      if (chipRef.current && chipRef.current.pointerId !== keep) chipRef.current = null;
      if (gutterPressRef.current && gutterPressRef.current.pointerId !== keep) {
        gutterPressRef.current = null;
      }
    };
    const onPointerDown = (event: PointerEvent) => cancelAll(event.pointerId);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (gestureRef.current.phase === 'dragging') event.preventDefault();
      cancelAll();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
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
    if (line) pressLine(line, event.pointerId, paneY(event.clientY), false);
  };
  // A press on a draggable line, from its handle or its band: the drag owns the gesture from here.
  const pressLine = (line: OverlayLine, pointerId: number, y: number, fromBand: boolean) => {
    if (gestureRef.current.phase === 'idle') {
      const lineY = handle.series.priceToCoordinate(line.price);
      dragOffsetRef.current = lineY !== null && Number.isFinite(lineY) ? lineY - y : 0;
      fromBandRef.current = fromBand;
    }
    apply(press(gestureRef.current, line.id, pointerId, y));
    if (gestureRef.current.phase !== 'idle' && !unlockRef.current) {
      unlockRef.current = lockChart(handle.chart);
    }
  };
  const onBandPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const y = paneY(event.clientY);
    const line = nearestLine(latestRef.current.lines, y, (price) =>
      handle.series.priceToCoordinate(price),
    );
    if (!line) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressLine(line, event.pointerId, y, true);
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
    const offset = dragOffsetRef.current;
    apply(
      move(gestureRef.current, event.pointerId, paneY(event.clientY), (y) => priceAt(y + offset)),
    );
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
    (kind: 'rows' | 'bands' | 'handles' | 'leaders', id: string) =>
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
        onContextMenu={preventDefault}
      />
      <div
        ref={(element) => {
          elementsRef.current.layer = element;
        }}
        role="group"
        aria-label={label}
        className="absolute top-0 left-0"
      >
        {/* The bands sit under every label and button, so those keep their own presses. */}
        {ordered
          .filter((line) => line.draggable)
          .map((line) => (
            <span
              key={line.id}
              ref={refFor('bands', line.id)}
              aria-hidden="true"
              hidden
              data-testid="chart-grab-band"
              data-line={line.id}
              className="pointer-events-auto absolute top-0 right-0 left-0 h-11 cursor-ns-resize touch-none select-none [-webkit-touch-callout:none]"
              onPointerDown={onBandPointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerCancel}
              onLostPointerCapture={onHandlePointerCancel}
              onContextMenu={preventDefault}
            />
          ))}
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
                onContextMenu={preventDefault}
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

/**
 * The draggable line within reach of a press at `y`: the nearest, and on a tie the one drawn on
 * top, which comes later in priority order (SPEC-CR-1 §5.1).
 */
export function nearestLine(
  lines: readonly OverlayLine[],
  y: number,
  toY: (price: number) => number | null,
): OverlayLine | null {
  let best: OverlayLine | null = null;
  let bestDistance = BAND_REACH;
  for (const line of lines) {
    if (!line.draggable) continue;
    const lineY = toY(line.price);
    if (lineY === null || !Number.isFinite(lineY)) continue;
    const distance = Math.abs(lineY - y);
    if (distance <= bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }
  return best;
}

/** A long-press on a handle or the gutter opens no menu or callout (Android, iOS Safari). */
const preventDefault = (event: { preventDefault: () => void }) => event.preventDefault();

/** Moves every handle, leader line and the gutter to the chart's current coordinates. */
function placeHandles(
  { chart, series }: ChartHandle,
  lines: readonly OverlayLine[],
  { rows, bands, handles, leaders, gutter, layer }: Elements,
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
    const band = bands.get(place.id);
    if (band) {
      // A pinned line is off the plot: only its label, at the edge, takes a press.
      band.hidden = place.lineY === null;
      if (place.lineY !== null) {
        band.style.transform = `translateY(${String(Math.round(place.lineY - BAND_REACH))}px)`;
      }
    }
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
  activation: 'border-dotted border-ink-muted bg-surface text-ink',
  pending: 'border-dotted border-ink-muted bg-surface text-ink-muted',
};

const ACTION_CLASSES: Record<LineAction['look'], string> = {
  plain: 'border border-line bg-surface text-ink',
  armed: 'bg-down text-surface',
  buy: 'bg-brand text-surface',
  sell: 'bg-down text-surface',
};
