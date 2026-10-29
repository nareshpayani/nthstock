import { useCallback, useRef } from 'react';

/** The full detent leaves this much (px) of the page showing above the sheet. */
const FULL_GAP = 12;

/**
 * The one place a sheet's `max-height` is written. It reads the sheet's `data-detent` (set by the
 * drag) and `data-keyboard-viewport` (the visible height in px while the keyboard is up), so the
 * full detent and the keyboard cap never overwrite each other.
 */
export function syncSheetMaxHeight(element: HTMLElement): void {
  const full = element.dataset.detent === 'full';
  const visible = Number(element.dataset.keyboardViewport ?? 0);
  if (visible > 0) {
    element.style.maxHeight = `${String(Math.round(full ? visible - FULL_GAP : visible * 0.9))}px`;
  } else {
    element.style.maxHeight = full
      ? `calc(100dvh - env(safe-area-inset-top) - ${String(FULL_GAP)}px)`
      : '';
  }
}

/**
 * Keeps a bottom sheet above the on-screen keyboard (SPEC-CR-1 §5.5). iPhone Safari lays fixed
 * elements out against the full screen and lets the keyboard cover them, so the sheet reads the
 * visual viewport and lifts itself by the keyboard's height, capping its own height to what is
 * left. Elsewhere the inset is 0 and nothing changes. Returns a ref callback for the sheet.
 */
export function useKeyboardInset(enabled: boolean): (element: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback(
    (element: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      // Deliberate: without a visual viewport (older browsers, jsdom) the sheet keeps its CSS
      // position, which is correct wherever the keyboard does not cover fixed elements.
      const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
      if (!enabled || !element || !viewport) return;
      let frame = 0;
      const apply = () => {
        frame = 0;
        const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        element.style.bottom = inset > 0 ? `${String(Math.round(inset))}px` : '';
        element.dataset.keyboard = inset > 0 ? 'open' : 'closed';
        if (inset > 0) element.dataset.keyboardViewport = String(viewport.height);
        else delete element.dataset.keyboardViewport;
        syncSheetMaxHeight(element);
      };
      // A keyboard animation fires many resize events: place once per frame.
      const place = () => {
        if (frame !== 0) return;
        frame = -1;
        const id = requestAnimationFrame(apply);
        if (frame === -1) frame = id;
      };
      apply();
      viewport.addEventListener('resize', place);
      viewport.addEventListener('scroll', place);
      cleanup.current = () => {
        viewport.removeEventListener('resize', place);
        viewport.removeEventListener('scroll', place);
        cancelAnimationFrame(frame);
        element.style.bottom = '';
        delete element.dataset.keyboard;
        delete element.dataset.keyboardViewport;
        syncSheetMaxHeight(element);
      };
    },
    [enabled],
  );
}
