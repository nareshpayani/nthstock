import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/shared/motion/useReducedMotion';

/** How fast the strip drifts (px per second) and how long it rests at each end (ms). */
export const AUTO_SCROLL_SPEED = 40;
export const AUTO_SCROLL_REST_MS = 2500;
/** Out and back this many times, then it rests at the start for good. */
export const AUTO_SCROLL_CYCLES = 3;
/** A gap between frames longer than this means the page was hidden; that time does not count. */
export const AUTO_SCROLL_HIDDEN_GAP_MS = 250;
/** While nothing overflows, look again this often (ms) instead of every frame. */
export const AUTO_SCROLL_RECHECK_MS = 1000;

type Phase = 'rest' | 'out' | 'back';

/**
 * Where a strip that drifts out to its end and back should be after `elapsedMs`, as a share of
 * its overflow (0 at the start, 1 at the end), or null once its cycles are done. Pure, for tests.
 */
export function driftAt(elapsedMs: number, overflowPx: number): number | null {
  const travel = (overflowPx / AUTO_SCROLL_SPEED) * 1000;
  const cycle = 2 * (AUTO_SCROLL_REST_MS + travel);
  if (overflowPx <= 0 || elapsedMs >= cycle * AUTO_SCROLL_CYCLES) return null;
  let t = elapsedMs % cycle;
  const phases: [Phase, number][] = [
    ['rest', AUTO_SCROLL_REST_MS],
    ['out', travel],
    ['rest', AUTO_SCROLL_REST_MS],
    ['back', travel],
  ];
  let at = 0;
  for (const [phase, length] of phases) {
    if (t < length) {
      if (phase === 'out') return t / length;
      if (phase === 'back') return 1 - t / length;
      return at;
    }
    t -= length;
    if (phase === 'out') at = 1;
    if (phase === 'back') at = 0;
  }
  return 0;
}

/**
 * A strip too wide for the screen drifts gently to its end and back so every item gets seen (A21),
 * a few times and then no more. A touch, a wheel, a key or keyboard focus on it stops the drift for good,
 * so the user is never fighting it (WCAG 2.2.2). Nothing moves under reduced motion, while the
 * page is hidden, or when everything already fits.
 */
export function useAutoScroll<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || prefersReducedMotion()) return;
    let frame = 0;
    let recheck: ReturnType<typeof setTimeout> | undefined;
    let start: number | undefined;
    let last: number | undefined;
    const stop = () => {
      cancelAnimationFrame(frame);
      clearTimeout(recheck);
      frame = 0;
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('wheel', stop);
      element.removeEventListener('focusin', stop);
      element.removeEventListener('keydown', stop);
    };
    const tick = (now: number) => {
      // Time while the page is hidden does not count, so it picks up where it was.
      if (last !== undefined && start !== undefined && now - last > AUTO_SCROLL_HIDDEN_GAP_MS)
        start += now - last;
      last = now;
      start ??= now;
      const overflow = element.scrollWidth - element.clientWidth;
      // Nothing to show yet (skeletons, or a layout that changes later): wait, do not give up,
      // but look again on a slow timer, not every frame (a frame loop costs the main thread).
      if (overflow <= 0) {
        start = undefined;
        last = undefined;
        recheck = setTimeout(() => {
          frame = requestAnimationFrame(tick);
        }, AUTO_SCROLL_RECHECK_MS);
        return;
      }
      const at = driftAt(now - start, overflow);
      if (at === null) {
        stop();
        return;
      }
      element.scrollLeft = Math.round(at * overflow);
      frame = requestAnimationFrame(tick);
    };
    element.addEventListener('pointerdown', stop);
    element.addEventListener('wheel', stop, { passive: true });
    element.addEventListener('focusin', stop);
    element.addEventListener('keydown', stop);
    frame = requestAnimationFrame(tick);
    return stop;
  }, [enabled]);
  return ref;
}
