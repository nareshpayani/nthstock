import { colors } from '@nthstock/tokens';
import { cn } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import type { IPriceLine } from 'lightweight-charts';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { withAlpha, type ChartHandle } from '@/features/charts';
import { safeStorage } from '@/shared/lib/safeStorage';
import { haptic } from '@/shared/motion/haptics';
import { animateSpring } from '@/shared/motion/spring';
import { RATCHET_GLIDE_MS, RATCHET_TRACE_MS, animateTween } from '@/shared/motion/tween';
import { prefersReducedMotion } from '@/shared/motion/useReducedMotion';
import { lockChart } from '../lib/chartLock';
import { panBy } from '../lib/panChart';
import { LINE_STYLES } from '../lib/lineStyles';
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
import { loupeText, placeLoupe } from '../model/loupe';
import { layoutHandles, snapToTick } from '../model/overlayLayout';
import { railStep, railTicks } from '../model/priceRail';
import { strings } from '../strings';

export type ChartOverlayProps = {
  handle: ChartHandle;
  /** The lines to draw, each at its current (or pending) price. */
  lines: readonly OverlayLine[];
  /** The instrument's tick in paise; every price from the chart snaps to it. */
  tickSize: number;
  /** Accessible name of the group of handles, e.g. "Chart orders for INFY". */
  label: string;
  /** The last traded price, for the loupe's distance and its side (SPEC-CR-1 §4.2). */
  ltp?: number | undefined;
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
  rail: HTMLCanvasElement | null;
  root: HTMLElement | null;
  live: HTMLElement | null;
  loupe: {
    card: HTMLElement;
    price: HTMLElement;
    distance: HTMLElement;
    detail: HTMLElement;
  } | null;
  layer: HTMLElement | null;
};
/** Prices a line is drawn at while it springs to its real one, by line id. */
type Settling = Map<string, { price: number; stop: () => void }>;
type Drawn = Map<string, { line: IPriceLine; price: number; tone: OverlayLine['tone'] }>;
type KeyMove = { id: string; price: number } | null;
/** Other lines while one is held: 45% opacity on the line's colour (§5.2). */
const DIMMED_ALPHA = 0.45;
/** How long after a drag a price change still counts as its answer (a rollback after a reject). */
const SETTLE_WINDOW_MS = 10_000;
/** The rail's width in px, from the axis's left edge. */
const RAIL_WIDTH = 10;

/** How long a new order's line takes to arrive from the rail (SPEC-CR-1 §5.7). */
const LINE_ARRIVAL_MS = 280;

/** Set once the first-run drag hint has been dismissed; it is never shown again (§5.7). */
export const DRAG_HINT_KEY = 'nthstock.dragHintSeen';

/** How strongly the trace left by a ratchet starts, before it fades (SPEC-CR-1 §5.3). */
const TRACE_ALPHA = 0.5;

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
  ltp,
  onGutterTap,
  onDragMove,
  onDragEnd,
  onHandleTap,
  onHandleDelete,
  onAction,
}: ChartOverlayProps) {
  const ordered = byPriority(lines);
  const describedBy = useId();
  // The first-run hint (SPEC-CR-1 §5.7, CR-T20): beside the first draggable line until any press
  // on the chart or a key on a line, then never again.
  const [hintSeen, setHintSeen] = useState(() => safeStorage.get(DRAG_HINT_KEY) !== null);
  const hintFor = hintSeen
    ? undefined
    : ordered.find((line) => line.draggable && line.tone !== 'pending')?.id;
  const dismissHint = () => {
    if (hintSeen) return;
    safeStorage.set(DRAG_HINT_KEY, '1');
    setHintSeen(true);
  };
  const elementsRef = useRef<Elements>({
    rows: new Map(),
    bands: new Map(),
    handles: new Map(),
    leaders: new Map(),
    gutter: null,
    rail: null,
    root: null,
    live: null,
    loupe: null,
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
  // The line being held, for the lift (SPEC-CR-1 §5.2), and where its last drag left it, so a
  // cancel, or a save the server rejects, springs it back instead of jumping (AC-04).
  const heldRef = useRef<string | null>(null);
  const lastMoveRef = useRef<{ id: string; price: number } | null>(null);
  const settleFromRef = useRef<{ id: string; price: number; until: number } | null>(null);
  const settlingRef = useRef<Settling>(new Map());
  // Faint lines left where a trailing stop ratcheted from, fading out (SPEC-CR-1 §5.3).
  const tracesRef = useRef(new Set<{ line: IPriceLine; stop: () => void }>());
  // Every line id this overlay has drawn, so only an order that is new to it arrives with the
  // "flies to the chart" moment (SPEC-CR-1 §5.7), not lines redrawn after a range or type switch.
  const knownRef = useRef<Set<string> | null>(null);
  const primitiveRef = useRef<RepaintPrimitive | null>(null);
  // The latest lines and callbacks, for the repaint hook and the event handlers.
  const tickSizeRef = useRef(tickSize);
  const latestRef = useRef({
    lines: ordered,
    ltp,
    on: { onGutterTap, onDragMove, onDragEnd, onHandleTap, onHandleDelete, onAction },
  });

  const unlock = () => {
    unlockRef.current?.();
    unlockRef.current = null;
  };

  // Lifts the held line and dims the rest (SPEC-CR-1 §5.2): attributes for the DOM, options for
  // the canvas lines. Written directly, like the handle positions, so it costs no React render.
  const hold = (id: string | null) => {
    if (heldRef.current === id) return;
    heldRef.current = id;
    const { layer, rows, bands, loupe } = elementsRef.current;
    if (layer) layer.dataset.holding = id ? 'true' : 'false';
    if (loupe && id === null) loupe.card.dataset.shown = 'false';
    for (const [rowId, row] of rows) row.dataset.held = String(rowId === id);
    for (const [bandId, band] of bands) band.dataset.held = String(bandId === id);
    for (const [lineId, drawn] of drawnRef.current) {
      const { color } = LINE_STYLES[drawn.tone];
      drawn.line.applyOptions(
        id === null
          ? { color, lineWidth: 1 }
          : lineId === id
            ? { color, lineWidth: 2 }
            : { color: withAlpha(color, DIMMED_ALPHA), lineWidth: 1 },
      );
    }
  };

  // The position chip gives under the finger (SPEC-CR-1 §5.3) until it lifts or starts a pan.
  const pressChip = (id: string | null) => {
    const { handles } = elementsRef.current;
    for (const [handleId, element] of handles) {
      element.dataset.pressed = String(handleId === id);
    }
  };

  // Moves a drawn line from `from` to its real price: a spring after the finger lets go (AC-04), a
  // 240 ms glide when the engine ratchets a trailing stop (§5.3). The handle follows it.
  const settle = (id: string, from: number, to: number, how: 'spring' | 'glide' = 'spring') => {
    if (!drawnRef.current.has(id)) return;
    settlingRef.current.get(id)?.stop();
    const entry: { price: number; stop: () => void } = { price: from, stop: () => undefined };
    settlingRef.current.set(id, entry);
    const animate = (
      onFrame: (value: number) => void,
      options: { instant: boolean; onDone: () => void },
    ) =>
      how === 'glide'
        ? animateTween(from, to, RATCHET_GLIDE_MS, onFrame, options)
        : animateSpring(from, to, onFrame, options);
    entry.stop = animate(
      (price) => {
        // Look the line up on every frame: it may have been removed (filled, cancelled) mid-spring.
        const drawn = drawnRef.current.get(id);
        if (!drawn) {
          stopSettling(id);
          return;
        }
        entry.price = price;
        drawn.line.applyOptions({ price });
        primitiveRef.current?.requestUpdate();
      },
      {
        instant: prefersReducedMotion(),
        onDone: () => {
          if (settlingRef.current.get(id) !== entry) return;
          settlingRef.current.delete(id);
          // The spring aimed at the price it started with; the line may have moved since.
          const drawn = drawnRef.current.get(id);
          drawn?.line.applyOptions({ price: drawn.price });
          primitiveRef.current?.requestUpdate();
        },
      },
    );
  };
  const stopSettling = (id: string) => {
    const entry = settlingRef.current.get(id);
    if (!entry) return;
    entry.stop();
    settlingRef.current.delete(id);
    const drawn = drawnRef.current.get(id);
    drawn?.line.applyOptions({ price: drawn.price });
  };

  // A ratchet leaves a short trace at the old stop that fades (§5.3); reduced motion leaves none.
  const leaveTrace = (price: number) => {
    if (prefersReducedMotion()) return;
    const { series } = handle;
    const { color, lineStyle } = LINE_STYLES.trailing;
    const line = series.createPriceLine({
      price,
      color: withAlpha(color, TRACE_ALPHA),
      lineStyle,
      lineWidth: 1,
      lineVisible: true,
      axisLabelVisible: false,
      title: '',
    });
    const trace: { line: IPriceLine; stop: () => void } = { line, stop: () => undefined };
    tracesRef.current.add(trace);
    trace.stop = animateTween(
      TRACE_ALPHA,
      0,
      RATCHET_TRACE_MS,
      (alpha) => line.applyOptions({ color: withAlpha(color, alpha) }),
      {
        onDone: () => {
          try {
            series.removePriceLine(line);
          } finally {
            tracesRef.current.delete(trace);
          }
        },
      },
    );
  };

  // A new order arrives from the rail (SPEC-CR-1 §5.7, X1): its tab slides in from the price
  // axis and its line fades up. Reduced motion draws it at once.
  const arrive = (id: string) => {
    if (prefersReducedMotion()) return;
    const { handles } = elementsRef.current;
    const tab = handles.get(id)?.querySelector<HTMLElement>('[data-testid="chart-tab"]');
    if (tab) {
      tab.dataset.arrived = 'true';
      tab.addEventListener('animationend', () => delete tab.dataset.arrived, { once: true });
    }
    const drawn = drawnRef.current.get(id);
    if (!drawn) return;
    const { color } = LINE_STYLES[drawn.tone];
    // Hidden from the first paint, so it never shows at full strength before the fade starts.
    drawn.line.applyOptions({ color: withAlpha(color, 0) });
    animateTween(
      0,
      1,
      LINE_ARRIVAL_MS,
      (alpha) => drawnRef.current.get(id)?.line.applyOptions({ color: withAlpha(color, alpha) }),
      { onDone: () => drawnRef.current.get(id)?.line.applyOptions({ color }) },
    );
  };

  // Says what a drag did, for screen readers (CR-T08); written to the live region, no render.
  const announce = (message: string) => {
    const region = elementsRef.current.live;
    if (region) region.textContent = message;
  };

  // Haptics and words for each step of a drag (SPEC-CR-1 §5.4, CR-T08): a light impact when the
  // line is picked up, a selection tick per price step, a stronger one crossing the LTP, success
  // on release. A rejected save is the caller's to signal.
  const feedback = (
    before: HandleGesture,
    step: { gesture: HandleGesture; effect: GestureEffect },
  ) => {
    const { effect } = step;
    const line = (id: string) => latestRef.current.lines.find((candidate) => candidate.id === id);
    if (effect.kind === 'move') {
      const last = lastMoveRef.current?.id === effect.id ? lastMoveRef.current.price : null;
      if (before.phase === 'pressed') {
        haptic('grab');
        const held = line(effect.id);
        if (held) announce(strings.drag.started(held.label, formatInr(effect.price)));
        return;
      }
      if (last === null || last === effect.price) return;
      const { ltp: mark } = latestRef.current;
      const crossed = mark !== undefined && last < mark !== effect.price < mark;
      haptic(crossed ? 'crossLtp' : 'tick');
    } else if (effect.kind === 'commit') {
      haptic('commit');
      announce(strings.drag.released(formatInr(effect.price)));
    } else if (effect.kind === 'cancel' && line(effect.id)) {
      // A line that went away mid-drag (filled, cancelled) is not "back where it was".
      announce(strings.drag.cancelled);
    }
  };

  const apply = (step: { gesture: HandleGesture; effect: GestureEffect }) => {
    feedback(gestureRef.current, step);
    gestureRef.current = step.gesture;
    if (step.gesture.phase === 'idle') unlock();
    hold(step.gesture.phase === 'idle' ? null : step.gesture.id);
    const { effect } = step;
    const { on } = latestRef.current;
    if (effect.kind === 'commit' || effect.kind === 'cancel') {
      const last = lastMoveRef.current;
      lastMoveRef.current = null;
      if (last?.id === effect.id) {
        settleFromRef.current = { ...last, until: performance.now() + SETTLE_WINDOW_MS };
      }
    }
    if (effect.kind === 'move') {
      lastMoveRef.current = { id: effect.id, price: effect.price };
      on.onDragMove?.(effect.id, effect.price);
    } else if (effect.kind === 'commit') on.onDragEnd?.(effect.id, effect.price);
    else if (effect.kind === 'cancel') on.onDragEnd?.(effect.id, null);
    else if (effect.kind === 'tap' && !fromBandRef.current) on.onHandleTap?.(effect.id);
  };
  // The latest `apply`, for the document listeners that are added once.
  const applyRef = useRef(apply);

  // One primitive per chart: its repaint hook is the only per-frame work the overlay does.
  useLayoutEffect(() => {
    const { series } = handle;
    const primitive = new RepaintPrimitive(() =>
      placeHandles(
        handle,
        latestRef.current.lines,
        elementsRef.current,
        settlingRef.current,
        tickSizeRef.current,
      ),
    );
    primitiveRef.current = primitive;
    series.attachPrimitive(primitive);
    const drawn = drawnRef.current;
    const settling = settlingRef.current;
    const traces = tracesRef.current;
    return () => {
      try {
        for (const trace of traces) {
          trace.stop();
          series.removePriceLine(trace.line);
        }
      } finally {
        traces.clear();
        unlockRef.current?.();
        unlockRef.current = null;
        for (const entry of settling.values()) entry.stop();
        settling.clear();
        series.detachPrimitive(primitive);
        for (const { line } of drawn.values()) series.removePriceLine(line);
        drawn.clear();
        primitiveRef.current = null;
      }
    };
  }, [handle]);

  // New lines: draw them, place their handles now, and repaint so the canvas agrees.
  useLayoutEffect(() => {
    latestRef.current = {
      lines: ordered,
      ltp,
      on: { onGutterTap, onDragMove, onDragEnd, onHandleTap, onHandleDelete, onAction },
    };
    applyRef.current = apply;
    tickSizeRef.current = tickSize;
    const before = new Map(
      [...drawnRef.current].map(([id, drawn]) => [id, { price: drawn.price, tone: drawn.tone }]),
    );
    syncPriceLines(handle.series, drawnRef.current, ordered);
    // A line that just left the finger and now has a new price (restored by a cancel, or rolled
    // back after a rejected save) springs there from where the finger left it (AC-04).
    const from = settleFromRef.current;
    // The line sprung back in this pass: the ratchet loop below must not turn it into a glide.
    let springing: string | null = null;
    if (from && (performance.now() > from.until || gestureRef.current.phase !== 'idle')) {
      settleFromRef.current = null;
    } else if (from) {
      const line = ordered.find((candidate) => candidate.id === from.id);
      if (!line) settleFromRef.current = null;
      else if (line.price !== from.price) {
        settleFromRef.current = null;
        springing = line.id;
        settle(line.id, from.price, line.price);
      }
    }
    // The engine ratcheted a trailing stop: the line glides up to it and leaves a fading trace
    // (§5.3). Not a move the user is making (drag or keys), nor one springing back after it.
    const active = gestureRef.current;
    for (const line of ordered) {
      const was = before.get(line.id);
      if (line.tone !== 'trailing' || was?.tone !== 'trailing' || was.price === line.price)
        continue;
      if (active.phase !== 'idle' && active.id === line.id) continue;
      if (keyMoveRef.current?.id === line.id || settleFromRef.current?.id === line.id) continue;
      if (springing === line.id) continue;
      // A glide or spring already under way carries on from where the line is drawn now.
      if (!drawnRef.current.has(line.id)) continue;
      const drawnFrom = settlingRef.current.get(line.id)?.price ?? was.price;
      settle(line.id, drawnFrom, line.price, 'glide');
      leaveTrace(drawnFrom);
    }
    const known = knownRef.current;
    for (const line of ordered) {
      if (known && !known.has(line.id) && (line.tone === 'buy' || line.tone === 'sell')) {
        arrive(line.id);
      }
    }
    knownRef.current = new Set([...(known ?? []), ...ordered.map((line) => line.id)]);
    for (const [id, entry] of settlingRef.current) {
      const drawn = drawnRef.current.get(id);
      if (drawn) drawn.line.applyOptions({ price: entry.price });
      else stopSettling(id);
    }
    // Keep the lift on lines drawn while one is held.
    if (heldRef.current) {
      const id = heldRef.current;
      heldRef.current = null;
      hold(id);
    }
    placeHandles(handle, ordered, elementsRef.current, settlingRef.current, tickSize);
    primitiveRef.current?.requestUpdate();
    // A position line removed mid-press ends the press, so a later pointerup taps nothing.
    if (chipRef.current && !ordered.some((line) => line.id === chipRef.current?.id)) {
      chipRef.current = null;
      pressChip(null);
    }
    // A line that went away mid-drag (filled or cancelled) ends the drag; the caller restores it.
    if (active.phase !== 'idle' && !ordered.some((line) => line.id === active.id)) {
      apply(cancel(active));
    }
  });

  // Any press on the chart, line or not, dismisses the hint.
  const hintShown = hintFor !== undefined;
  const dismissHintRef = useRef(dismissHint);
  useLayoutEffect(() => {
    dismissHintRef.current = dismissHint;
  });
  useEffect(() => {
    const area = elementsRef.current.root?.parentElement;
    if (!hintShown || !area) return;
    const onPress = () => dismissHintRef.current();
    area.addEventListener('pointerdown', onPress, true);
    return () => area.removeEventListener('pointerdown', onPress, true);
  }, [hintShown]);

  // A second finger anywhere, or Escape, cancels what the first finger started (§9.1, T20): a
  // drag restores its line, a press on the chip neither opens it nor keeps panning, and a press
  // on the gutter places no ghost (it was the start of a pinch).
  useEffect(() => {
    const cancelAll = (keep?: number) => {
      const active = gestureRef.current;
      if (active.phase !== 'idle' && active.pointerId !== keep) {
        applyRef.current(cancel(active));
      }
      if (chipRef.current && chipRef.current.pointerId !== keep) {
        chipRef.current = null;
        pressChip(null);
      }
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
      pressChip(id);
      return;
    }
    if (line) pressLine(line, event.pointerId, paneY(event.clientY), false);
  };
  // A press on a draggable line, from its handle or its band: the drag owns the gesture from here.
  const pressLine = (line: OverlayLine, pointerId: number, y: number, fromBand: boolean) => {
    if (gestureRef.current.phase === 'idle') {
      stopSettling(line.id);
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
        pressChip(null);
      }
      if (chip.panning) panBy(handle.chart, event.clientX - chip.x);
      chip.x = event.clientX;
      return;
    }
    const offset = dragOffsetRef.current;
    apply(
      move(gestureRef.current, event.pointerId, paneY(event.clientY), (y) => priceAt(y + offset)),
    );
    const active = gestureRef.current;
    if (active.phase === 'dragging' && active.pointerId === event.pointerId) {
      showLoupe(active.id, active.price, event.clientX, event.clientY);
    }
  };

  // The loupe (SPEC-CR-1 §4.2, CR-T07): a card beside the finger with the price being set, its
  // distance from the LTP and what it is worth. Written straight to the DOM on each move.
  const showLoupe = (id: string, price: number, clientX: number, clientY: number) => {
    const { loupe, root } = elementsRef.current;
    const line = latestRef.current.lines.find((candidate) => candidate.id === id);
    if (!loupe || !root || !line) return;
    const { ltp: last } = latestRef.current;
    const text = loupeText(price, last, line.loupe);
    loupe.price.textContent = text.price;
    loupe.distance.textContent = text.distance ?? '';
    loupe.distance.hidden = text.distance === null;
    loupe.detail.textContent = text.detail ?? '';
    loupe.detail.hidden = text.detail === null;
    const box = root.getBoundingClientRect();
    const place = placeLoupe({
      x: clientX - box.left,
      y: clientY - box.top,
      width: box.width,
      height: handle.chart.paneSize(0).height,
      cardWidth: loupe.card.offsetWidth,
      cardHeight: loupe.card.offsetHeight,
      aboveLtp: last === undefined || price >= last,
    });
    loupe.card.style.transform = `translate(${String(Math.round(place.left))}px, ${String(Math.round(place.top))}px)`;
    loupe.card.dataset.side = place.side;
    loupe.card.dataset.shown = 'true';
  };
  const onHandlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const chip = chipRef.current;
    if (chip) {
      if (chip.pointerId !== event.pointerId) return;
      chipRef.current = null;
      pressChip(null);
      if (!chip.panning) latestRef.current.on.onHandleTap?.(chip.id);
      return;
    }
    apply(release(gestureRef.current, event.pointerId, paneY(event.clientY)));
  };
  const onHandlePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    if (chipRef.current?.pointerId === event.pointerId) {
      pressChip(null);
      chipRef.current = null;
    }
    apply(cancel(gestureRef.current));
  };

  // Keyboard (§13): arrows move one tick, Shift ten; Enter saves; Escape restores.
  const onHandleKeyDown = (line: OverlayLine) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' && event.key !== 'Shift') dismissHint();
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
      settleFromRef.current = { ...current, until: performance.now() + SETTLE_WINDOW_MS };
      on.onDragEnd?.(line.id, null);
      announce(strings.drag.cancelled);
      return;
    }
    if (event.key === 'Enter' && current) {
      event.preventDefault();
      keyMoveRef.current = null;
      haptic('commit');
      on.onDragEnd?.(line.id, current.price);
      announce(strings.drag.released(formatInr(current.price)));
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
    // The live region speaks the start only; each step is the handle's own value change.
    if (!current) announce(strings.drag.keyStarted(line.label, formatInr(price)));
  };
  const onHandleBlur = (line: OverlayLine) => () => {
    const current = keyMoveRef.current;
    if (current?.id !== line.id) return;
    keyMoveRef.current = null;
    settleFromRef.current = { ...current, until: performance.now() + SETTLE_WINDOW_MS };
    latestRef.current.on.onDragEnd?.(line.id, null);
    announce(strings.drag.cancelled);
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
      ref={(element) => {
        elementsRef.current.root = element;
      }}
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
      >
        {/* The price rail: a ruler's minor ticks along the axis (SPEC-CR-1 §4.2). */}
        <canvas
          ref={(element) => {
            elementsRef.current.rail = element;
          }}
          data-testid="chart-rail"
          className="pointer-events-none absolute top-0 left-0"
        />
      </div>
      <div
        ref={(element) => {
          elementsRef.current.layer = element;
        }}
        role="group"
        aria-label={label}
        data-holding="false"
        className="group/layer absolute top-0 left-0"
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
              className="pointer-events-auto absolute top-0 right-0 left-0 h-11 cursor-ns-resize touch-none select-none [-webkit-touch-callout:none] data-[held=true]:bg-brand/7"
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
              className={cn(
                'group/row absolute top-0 right-0 flex items-center gap-1',
                'transition-opacity duration-[var(--nth-duration-fast)] ease-out motion-reduce:transition-none',
                'group-data-[holding=true]/layer:not-data-[held=true]:opacity-45',
              )}
            >
              <button
                ref={refFor('handles', line.id)}
                type="button"
                // The name is the visible label (WCAG 2.5.3); what the keys do is the description.
                aria-label={line.label}
                aria-describedby={
                  line.id === hintFor
                    ? `${describedBy}-${line.id} ${describedBy}-hint`
                    : `${describedBy}-${line.id}`
                }
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
                {/* A notched tab on the line; a draggable one carries a grip (SPEC-CR-1 §4.2). */}
                <span
                  aria-hidden="true"
                  data-testid="chart-tab"
                  className={cn(
                    'relative ml-1 flex items-center gap-1.5 rounded-sm border py-0.5 pr-2 pl-2 font-mono text-label whitespace-nowrap tabular-nums shadow-sm',
                    "before:absolute before:top-1/2 before:-left-1 before:size-2 before:-translate-y-1/2 before:rotate-45 before:border-b before:border-l before:[border-color:inherit] before:[border-style:inherit] before:[background:inherit] before:content-['']",
                    'origin-left transition-[transform,box-shadow] duration-[var(--nth-duration-fast)] ease-out motion-reduce:transition-none',
                    'group-data-[held=true]/row:scale-[1.04] group-data-[held=true]/row:shadow-lifted',
                    'data-[arrived=true]:animate-line-in',
                    'group-data-[pressed=true]:scale-[0.96] group-data-[pressed=true]:shadow-none',
                    TONE_CLASSES[line.tone],
                    line.id === hintFor && 'animate-drag-hint motion-reduce:animate-none',
                  )}
                >
                  {line.draggable ? (
                    <svg
                      data-testid="chart-tab-grip"
                      width="7"
                      height="9"
                      viewBox="0 0 7 9"
                      className="shrink-0"
                    >
                      <path d="M0 1h7M0 4.5h7M0 8h7" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  ) : null}
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
              {line.id === hintFor ? (
                <span
                  id={`${describedBy}-hint`}
                  data-testid="chart-drag-hint"
                  className={cn(
                    'pointer-events-none absolute right-0 rounded-sm bg-ink px-2 py-1 text-label whitespace-nowrap text-surface shadow-sm',
                    // Under a line in the top half of the plot, over one in the bottom half.
                    'top-full mt-1 group-data-[low=true]/row:top-auto group-data-[low=true]/row:bottom-full group-data-[low=true]/row:mt-0 group-data-[low=true]/row:mb-1',
                  )}
                >
                  {strings.drag.hint}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div
        ref={(element) => {
          elementsRef.current.live = element;
        }}
        role="status"
        data-testid="chart-drag-status"
        className="sr-only"
      />
      {/* Shown only while a line is dragged; the live region says the same in words (CR-T08). */}
      <div
        ref={(card) => {
          const spans = card?.querySelectorAll<HTMLElement>('[data-part]');
          const [price, distance, detail] = spans ? [...spans] : [];
          elementsRef.current.loupe =
            card && price && distance && detail ? { card, price, distance, detail } : null;
        }}
        aria-hidden="true"
        data-testid="chart-loupe"
        data-shown="false"
        className={cn(
          'absolute top-0 left-0 z-10 flex w-44 flex-col gap-0.5 rounded-lg bg-ink px-3 py-2.5 text-surface shadow-lifted',
          'opacity-0 transition-opacity duration-[var(--nth-duration-fast)] ease-out data-[shown=true]:opacity-100 motion-reduce:transition-none',
        )}
      >
        <span data-part="price" className="font-mono text-headline font-medium tabular-nums" />
        <span data-part="distance" className="font-mono text-label text-line tabular-nums" />
        <span data-part="detail" className="text-label text-line" />
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
  { rows, bands, handles, leaders, gutter, rail, layer }: Elements,
  settling: Settling,
  tickSize: number,
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
  if (rail) drawRail(rail, series, height, tickSize);
  // A line springing to its price is placed where it is drawn, not where it is going.
  const placed =
    settling.size === 0
      ? lines
      : lines.map((line) => {
          const entry = settling.get(line.id);
          return entry ? { ...line, price: entry.price } : line;
        });
  const layout = layoutHandles(placed, (price) => series.priceToCoordinate(price), { height });
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
      row.dataset.low = String(place.labelY > height / 2);
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

/** Draws the rail's ticks for the visible prices; every fifth is longer. */
function drawRail(
  canvas: HTMLCanvasElement,
  series: ChartHandle['series'],
  height: number,
  tickSize: number,
): void {
  const ratio = window.devicePixelRatio || 1;
  const width = RAIL_WIDTH;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${String(width)}px`;
    canvas.style.height = `${String(height)}px`;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const high = series.coordinateToPrice(0);
  const low = series.coordinateToPrice(height);
  if (high === null || low === null || !(height > 0)) return;
  const ticks = railTicks(high, low, railStep((high - low) / height, tickSize), (price) =>
    series.priceToCoordinate(price),
  );
  context.lineWidth = 1;
  context.beginPath();
  context.strokeStyle = withAlpha(colors['ink-muted'], RAIL_MINOR_ALPHA);
  for (const tick of ticks) {
    if (tick.major) continue;
    const y = Math.round(tick.y) + 0.5;
    context.moveTo(0, y);
    context.lineTo(4, y);
  }
  context.stroke();
  context.beginPath();
  context.strokeStyle = colors['ink-muted'];
  for (const tick of ticks) {
    if (!tick.major) continue;
    const y = Math.round(tick.y) + 0.5;
    context.moveTo(0, y);
    context.lineTo(7, y);
  }
  context.stroke();
}

/** The rail's minor ticks: a quiet grey between the hairline and the muted text. */
const RAIL_MINOR_ALPHA = 0.4;

const TONE_CLASSES: Record<OverlayLine['tone'], string> = {
  buy: 'border-brand bg-brand text-surface',
  sell: 'border-down bg-down text-surface',
  ghost: 'border-dashed border-ink-muted bg-surface text-ink',
  position: 'border-ink bg-ink text-surface',
  trailing: 'border-dashed border-marigold-ink bg-marigold text-ink',
  activation: 'border-dotted border-ink-muted bg-surface text-ink',
  pending: 'border-dotted border-ink-muted bg-surface text-ink-muted',
};

const ACTION_CLASSES: Record<LineAction['look'], string> = {
  plain: 'border border-line bg-surface text-ink',
  armed: 'bg-down text-surface',
  buy: 'bg-brand text-surface',
  sell: 'bg-down text-surface',
};
