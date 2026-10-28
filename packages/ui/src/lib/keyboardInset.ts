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
      const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
      if (!enabled || !element || !viewport) return;
      const place = () => {
        const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        element.style.bottom = inset > 0 ? `${String(Math.round(inset))}px` : '';
        element.style.maxHeight = inset > 0 ? `${String(Math.round(viewport.height * 0.9))}px` : '';
        element.dataset.keyboard = inset > 0 ? 'open' : 'closed';
      };
      place();
      viewport.addEventListener('resize', place);
      viewport.addEventListener('scroll', place);
      cleanup.current = () => {
        viewport.removeEventListener('resize', place);
        viewport.removeEventListener('scroll', place);
      };
    },
    [enabled],
  );
}
