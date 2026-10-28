import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

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

type Drag = { pointerId: number; startY: number; lastY: number; lastT: number; speed: number };

export type SheetDrag = {
  /** Ref callback for the sheet panel, which the drag moves. */
  panelRef: (element: HTMLElement | null) => void;
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
 * through `onDismiss` (the sheet's own Close, so focus return and `onOpenChange` stay the same);
 * otherwise it eases back in 280 ms. The panel is moved with a transform written straight to the
 * element, never React state. A press on a button in the header is left to the button.
 */
export function useSheetDrag(enabled: boolean, onDismiss: () => void): SheetDrag {
  const panel = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);

  const panelRef = useCallback((element: HTMLElement | null) => {
    panel.current = element;
    if (!element) {
      // Closed mid-drag (Escape, a store, the parent): no pointerup will arrive to clear this.
      drag.current = null;
      moved.current = false;
    }
  }, []);

  const springBack = (element: HTMLElement) => {
    element.style.transition = reducedMotion()
      ? ''
      : 'transform var(--nth-duration-slow) var(--nth-ease-out)';
    element.style.transform = '';
  };

  const settle = (dismiss: boolean) => {
    const element = panel.current;
    if (!element) return;
    if (!dismiss) {
      springBack(element);
      return;
    }
    // The close animation starts from where the finger left the sheet.
    element.style.transition = '';
    onDismiss();
    // A vetoed or ignored close leaves the panel open and offset: bring it back.
    requestAnimationFrame(() => {
      if (element.isConnected && element.dataset.state === 'open') springBack(element);
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button > 0 || drag.current) return;
    if ((event.target as Element).closest('button, a, input, select, textarea')) return;
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
  };

  const end = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    drag.current = null;
    if (!moved.current) return;
    const dy = event.clientY - active.startY;
    const height = panel.current?.getBoundingClientRect().height ?? 0;
    const flick = event.timeStamp - active.lastT <= STALE_MS && active.speed >= FLICK_SPEED;
    const dismiss = !cancelled && dy > 0 && (dy > height * DISMISS_FRACTION || flick);
    settle(dismiss);
  };

  return {
    panelRef,
    grabProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => end(event, false),
      onPointerCancel: (event) => end(event, true),
      onLostPointerCapture: (event) => end(event, true),
    },
  };
}
