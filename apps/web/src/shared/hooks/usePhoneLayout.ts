import { useCallback, useSyncExternalStore } from 'react';

/** A phone turned sideways (SPEC-CR-1 §6.2): under 500 px tall and narrower than a desktop. */
const LANDSCAPE_QUERY = '(max-height: 499.98px) and (max-width: 1023.98px)';

/**
 * Below Tailwind's `md` breakpoint, or a phone in landscape: the phone layout of SPEC-TFC-1 §9.4
 * (bottom sheets, the instrument page's tabs and sticky bottom bar).
 */
const PHONE_QUERY = `(max-width: 767.98px), ${LANDSCAPE_QUERY}`;

/**
 * A tablet or an unfolded foldable, 600 to 1023 px wide (SPEC-CR-1 §6.2): trading panels dock
 * beside the page instead of covering it.
 */
const DOCKED_QUERY = '(min-width: 600px) and (max-width: 1023.98px) and (min-height: 500px)';

/** Below Tailwind's `lg` breakpoint, where the watchlist rail gives way to the menu drawer. */
const NARROW_QUERY = '(max-width: 1023.98px)';

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

/** True on a phone in landscape (SPEC-CR-1 §6.2): the chart takes the height, the price one line. */
export function useLandscapePhone(): boolean {
  return useMediaQuery(LANDSCAPE_QUERY);
}

/** True from 600 to 1023 px wide (SPEC-CR-1 §6.2), where trading panels dock beside the page. */
export function useDockedPanels(): boolean {
  return useMediaQuery(DOCKED_QUERY);
}

/** True on a touch screen (a coarse pointer): controls take their 44 px touch size (§6.3). */
export function useTouchScreen(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/** True below 1024 px (Tailwind's `lg`), where the shell hides the watchlist rail (NSTOCK-0465). */
export function useNarrowScreen(): boolean {
  return useMediaQuery(NARROW_QUERY);
}
