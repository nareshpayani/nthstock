import type { CrosshairMode, IChartApi, LogicalRange } from 'lightweight-charts';
import { zoomedLogicalRange } from './chartZoom';

/** The chart calls the touch model needs. */
export type LockableChart = Pick<IChartApi, 'options' | 'applyOptions' | 'timeScale'>;

/** A first move shorter than this (px) decides nothing yet. */
export const DECIDE_PX = 2;
/** A second press this soon (ms) and this near (px) after a tap starts a one-thumb zoom. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;
/** A tap moves less than this (px) and lifts within this (ms). */
const TAP_PX = 10;
const TAP_MS = 250;
/** Sliding this far (px) is one zoom step (the − + buttons' step). Down zooms in, up zooms out. */
export const ZOOM_STEP_PX = 60;

/** `CrosshairMode.Hidden`. A type-only import keeps the library out of this module's weight. */
const CROSSHAIR_HIDDEN = 2 as CrosshairMode;

export type SwipeAxis = 'vertical' | 'horizontal';

/** Which way a first move points. Ties go to the page, so a straight-down swipe always scrolls. */
export function swipeAxis(dx: number, dy: number): SwipeAxis | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return null;
  return Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
}

type Start = { x: number; y: number; at: number; range: LogicalRange | null };

/**
 * The one-thumb touch model for a chart you can pan (A13). One direction per swipe, decided by the
 * first move: up or down scrolls the page and the chart stays put (its pan and zoom are off until
 * the finger lifts, and any pan it began is undone); sideways pans the chart and the page does not
 * scroll. Double-tap and slide zooms, as in Google Maps: down zooms in, up zooms out, keeping the
 * latest bar at the right edge. Two fingers are a pinch and are left to the chart. Returns the
 * teardown.
 */
export function installDirectionLock(
  host: HTMLElement,
  chart: LockableChart,
  now: () => number = () => performance.now(),
): () => void {
  let start: Start | null = null;
  let axis: SwipeAxis | 'zoom' | null = null;
  let restore: (() => void) | null = null;
  let lastTap: { x: number; y: number; at: number } | null = null;

  /** Turns the chart's own handling off (and the crosshair, for a zoom) until `release`. */
  const lock = (hideCrosshair: boolean) => {
    const { handleScroll, handleScale, crosshair } = chart.options();
    chart.applyOptions({
      handleScroll: false,
      handleScale: false,
      ...(hideCrosshair ? { crosshair: { mode: CROSSHAIR_HIDDEN } } : {}),
    });
    restore = () =>
      chart.applyOptions({
        handleScroll,
        handleScale,
        ...(hideCrosshair ? { crosshair: { mode: crosshair.mode } } : {}),
      });
  };

  const release = () => {
    restore?.();
    restore = null;
    start = null;
    axis = null;
  };

  const onStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    release();
    if (event.touches.length !== 1 || !touch) {
      // A second finger: a pinch the chart handles.
      lastTap = null;
      return;
    }
    const at = now();
    start = {
      x: touch.clientX,
      y: touch.clientY,
      at,
      range: chart.timeScale().getVisibleLogicalRange(),
    };
    const tap = lastTap;
    lastTap = null;
    if (
      tap &&
      at - tap.at <= DOUBLE_TAP_MS &&
      Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) <= DOUBLE_TAP_PX
    ) {
      axis = 'zoom';
      lock(true);
    }
  };

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!start || event.touches.length !== 1 || !touch) return;
    if (axis === 'zoom') {
      if (event.cancelable) event.preventDefault();
      if (start.range) {
        const steps = (touch.clientY - start.y) / ZOOM_STEP_PX;
        chart.timeScale().setVisibleLogicalRange(zoomedLogicalRange(start.range, steps));
      }
      return;
    }
    if (axis === null) {
      axis = swipeAxis(touch.clientX - start.x, touch.clientY - start.y);
      if (axis === 'vertical') {
        lock(false);
        if (start.range) chart.timeScale().setVisibleLogicalRange(start.range);
      }
    }
    // Sideways belongs to the chart: the page must not scroll under it.
    if (axis === 'horizontal' && event.cancelable) event.preventDefault();
  };

  const onEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    const pressed = start;
    const wasZoom = axis === 'zoom';
    release();
    if (!pressed || !touch || wasZoom || event.touches.length > 0) return;
    const at = now();
    const moved = Math.hypot(touch.clientX - pressed.x, touch.clientY - pressed.y);
    lastTap =
      moved < TAP_PX && at - pressed.at <= TAP_MS
        ? { x: touch.clientX, y: touch.clientY, at }
        : null;
  };

  const onCancel = () => {
    release();
    lastTap = null;
  };

  host.addEventListener('touchstart', onStart, { passive: true });
  host.addEventListener('touchmove', onMove, { passive: false });
  host.addEventListener('touchend', onEnd, { passive: true });
  host.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    release();
    host.removeEventListener('touchstart', onStart);
    host.removeEventListener('touchmove', onMove);
    host.removeEventListener('touchend', onEnd);
    host.removeEventListener('touchcancel', onCancel);
  };
}
