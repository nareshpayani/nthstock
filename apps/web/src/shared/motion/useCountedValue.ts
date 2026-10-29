import { useEffect, useRef, useState } from 'react';
import { animateTween } from './tween';
import { prefersReducedMotion } from './useReducedMotion';

/** How long a figure takes to count to its new value (A15): long enough to read as a count. */
export const COUNT_MS = 320;

/**
 * A number that counts to each new value instead of jumping (A15), for money the eye rests on:
 * the order value as the quantity changes, a live P&L. Whole units only (paise stay integers).
 * The first value shows at once; under reduced motion every value does.
 */
export function useCountedValue(target: number, durationMs = COUNT_MS): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const from = shownRef.current;
    return animateTween(
      from,
      target,
      durationMs,
      (value) => {
        shownRef.current = Math.round(value);
        setShown(shownRef.current);
      },
      { instant: prefersReducedMotion() },
    );
  }, [target, durationMs]);
  return shown;
}
