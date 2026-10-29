import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { syncSheetMaxHeight } from './keyboardInset.js';
import { animateSpring } from './spring.js';

/** Past this share of its height a released sheet closes (SPEC-CR-1 §5.5). */
export const DISMISS_FRACTION = 0.3;
/** A flick at this speed or faster (px per ms, downwards) closes it however far it moved. */
export const FLICK_SPEED = 0.5;
/** Upward pulls past the open position move a quarter as far, so the sheet feels anchored. */
const OVERPULL = 0.25;
/** A finger still for longer than this (ms) before lifting has no flick left in it. */
const STALE_MS = 100;
/** Below this many px a press is a tap, not a drag. */
const SLOP = 4;
/** An upward pull this far (px, before the resistance) opens a sheet with more to show in full. */
export const FULL_PULL = 40;
/** How much of the backdrop's dim a sheet dragged all the way down takes away (A14). */
const DIM_FADE = 0.8;
/** A flicked close takes the time its speed needs to finish the distance, within these (ms). */
const CLOSE_MIN_MS = 120;
const CLOSE_MAX_MS = 240;

type Drag = { pointerId: number; startY: number; lastY: number; lastT: number; speed: number };

export type SheetDrag = {
  /** Ref callback for the sheet panel, which the drag moves. */
  panelRef: (element: HTMLElement | null) => void;
  /** Ref callback for the backdrop, which lightens as the sheet is dragged down. */
  overlayRef: (element: HTMLElement | null) => void;
  /** Spread on each grab zone: the grabber and the header. */
  grabProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  };
};

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Drag to dismiss for a bottom sheet (SPEC-CR-1 §5.5, CR-T10). The sheet follows the finger from
 * its grabber or header; released past 30% of its height, or on a fast downward flick, it closes
 * through `onDismiss` (the sheet's own Close, so focus return and `onOpenChange` stay the same).
 * Otherwise the spring takes it back from the speed the finger let go at (A14). The backdrop
 * lightens as the sheet goes down. A sheet with more to show than fits opens in full on an upward
 * pull, and a pull down from full returns it to its first height before a further one closes it.
 * Everything is written straight to the elements, never React state. A press on a button in the
 * header is left to the button.
 */
export function useSheetDrag(enabled: boolean, onDismiss: () => void): SheetDrag {
  const panel = useRef<HTMLElement | null>(null);
  const overlay = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);
  const stopSpring = useRef<(() => void) | null>(null);

  const overlayRef = useCallback((element: HTMLElement | null) => {
    overlay.current = element;
  }, []);
  const dim = (offset: number, height: number) => {
    if (!overlay.current) return;
    const lift = height > 0 ? Math.min(1, Math.max(0, offset) / height) : 0;
    overlay.current.style.opacity = lift > 0 ? String(1 - lift * DIM_FADE) : '';
  };

  const panelRef = useCallback((element: HTMLElement | null) => {
    panel.current = element;
    if (!element) {
      // Closed mid-drag (Escape, a store, the parent): no pointerup will arrive to clear this.
      drag.current = null;
      moved.current = false;
      stopSpring.current?.();
      stopSpring.current = null;
    }
  }, []);

  // From `from` px below its resting place, at `velocity` px per second, back to rest.
  const springBack = (element: HTMLElement, from = 0, velocity = 0) => {
    stopSpring.current?.();
    element.style.transition = '';
    const height = element.getBoundingClientRect().height;
    stopSpring.current = animateSpring(
      from,
      0,
      (offset) => {
        element.style.transform = offset === 0 ? '' : `translateY(${String(offset)}px)`;
        dim(offset, height);
      },
      { velocity, instant: reducedMotion() || from === 0 },
    );
  };

  // Grows the sheet to the full detent or back, keeping it where the finger left it on screen,
  // then springs it home: the bottom stays put, so the top moves by the change in height.
  const resize = (element: HTMLElement, full: boolean, offset: number, velocity: number) => {
    const before = element.getBoundingClientRect().height;
    element.dataset.detent = full ? 'full' : 'compact';
    syncSheetMaxHeight(element);
    const after = element.getBoundingClientRect().height;
    springBack(element, offset + after - before, velocity);
  };

  const canGrow = (element: HTMLElement) => {
    const body = element.querySelector<HTMLElement>('[data-part="sheet-body"]');
    return body !== null && body.scrollHeight > body.clientHeight + 1;
  };

  const settle = (dismiss: boolean, offset = 0, speed = 0, distance = 0) => {
    const element = panel.current;
    if (!element) return;
    if (!dismiss) {
      springBack(element, offset, speed * 1000);
      return;
    }
    // The close animation starts from where the finger left the sheet, and a fast flick finishes
    // sooner than the standard close.
    stopSpring.current?.();
    element.style.transition = '';
    if (speed > 0 && !reducedMotion()) {
      const ms = Math.min(CLOSE_MAX_MS, Math.max(CLOSE_MIN_MS, distance / speed));
      element.style.animationDuration = `${String(Math.round(ms))}ms`;
      if (overlay.current)
        overlay.current.style.animationDuration = element.style.animationDuration;
    }
    onDismiss();
    // A vetoed or ignored close leaves the panel open and offset: bring it back.
    requestAnimationFrame(() => {
      if (!element.isConnected || element.dataset.state !== 'open') return;
      // The close was vetoed: the shortened close time must not leak into the next real close.
      element.style.animationDuration = '';
      if (overlay.current) overlay.current.style.animationDuration = '';
      springBack(element);
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button > 0 || drag.current) return;
    if ((event.target as Element).closest('button, a, input, select, textarea')) return;
    stopSpring.current?.();
    stopSpring.current = null;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer is already gone (InvalidStateError); move events still reach the grab zone.
    }
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      speed: 0,
    };
    moved.current = false;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current;
    const element = panel.current;
    if (!active || !element || event.pointerId !== active.pointerId) return;
    const dy = event.clientY - active.startY;
    if (!moved.current && Math.abs(dy) < SLOP) return;
    moved.current = true;
    const dt = event.timeStamp - active.lastT;
    if (dt > 0) active.speed = (event.clientY - active.lastY) / dt;
    active.lastY = event.clientY;
    active.lastT = event.timeStamp;
    element.style.transition = 'none';
    element.style.transform = `translateY(${String(dy >= 0 ? dy : dy * OVERPULL)}px)`;
    dim(dy, element.getBoundingClientRect().height);
  };

  const end = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    drag.current = null;
    if (!moved.current) return;
    const element = panel.current;
    if (!element) return;
    const dy = event.clientY - active.startY;
    const offset = dy >= 0 ? dy : dy * OVERPULL;
    const height = element.getBoundingClientRect().height;
    const fresh = event.timeStamp - active.lastT <= STALE_MS;
    const speed = fresh ? active.speed : 0;
    const flick = speed >= FLICK_SPEED;
    const far = dy > height * DISMISS_FRACTION || flick;
    const full = element.dataset.detent === 'full';
    if (!cancelled && !full && (dy < -FULL_PULL || speed <= -FLICK_SPEED) && canGrow(element)) {
      resize(element, true, offset, speed * 1000);
    } else if (!cancelled && full && dy > 0 && far) {
      resize(element, false, offset, speed * 1000);
    } else {
      settle(!cancelled && dy > 0 && far, offset, speed, height - dy);
    }
  };

  return {
    panelRef,
    overlayRef,
    grabProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => end(event, false),
      onPointerCancel: (event) => end(event, true),
      onLostPointerCapture: (event) => end(event, true),
    },
  };
}
