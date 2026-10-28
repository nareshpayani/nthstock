import { useCallback, useRef } from 'react';

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
        element.style.maxHeight = inset > 0 ? `${String(Math.round(viewport.height * 0.9))}px` : '';
        element.dataset.keyboard = inset > 0 ? 'open' : 'closed';
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
        element.style.maxHeight = '';
        delete element.dataset.keyboard;
      };
    },
    [enabled],
  );
}
