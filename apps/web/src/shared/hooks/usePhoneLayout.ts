import { useCallback, useSyncExternalStore } from 'react';

/**
 * Below Tailwind's `md` breakpoint: the phone layout of SPEC-TFC-1 §9.4 (bottom sheets, the
 * instrument page's tabs and sticky bottom bar). Covers phones up to large ones in portrait.
 */
const PHONE_QUERY = '(max-width: 767.98px)';

/** Whether a media query matches, following changes. False where `matchMedia` is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const snapshot = useCallback(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** True on a phone-width screen (§9.4): the deliberate phone layout, not a shrunk desktop. */
export function usePhoneLayout(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
