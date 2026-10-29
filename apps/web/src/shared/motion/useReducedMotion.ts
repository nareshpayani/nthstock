import { useMediaQuery } from '../hooks/usePhoneLayout';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the user asks for less motion (SPEC-CR-1 §5.8): springs and slides become instant or a
 * short fade, digit rolls become swaps, the drag hint does not nudge.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

/** The same question outside React, read at the moment of use. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}
