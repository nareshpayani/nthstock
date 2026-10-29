import { useEffect } from 'react';

/** The longest the mock worker waits for the first page to paint (NSTOCK-0469). */
export const FIRST_PAINT_CAP_MS = 1000;

let markPainted: () => void = () => undefined;
const painted = new Promise<void>((resolve) => {
  markPainted = resolve;
});

/**
 * Marks the first page as painted, from the frame after its first commit (NSTOCK-0469). The app
 * shell and the login page call it: they are what a cold load shows first.
 */
export function useMarkFirstPaint(): void {
  useEffect(() => {
    // A frame for the browser to paint the commit, then a task so the paint itself has happened.
    window.requestAnimationFrame(() => {
      window.setTimeout(markPainted, 0);
    });
  }, []);
}

/**
 * Resolves once the first page has painted, or after `FIRST_PAINT_CAP_MS` at most. msw mode starts
 * the mock worker here instead of at boot (NSTOCK-0469): building the mock market is about 300 ms
 * of main-thread work, and run beside the first render it held the header, rail and hero back.
 */
export function afterFirstPaint(capMs: number = FIRST_PAINT_CAP_MS): Promise<void> {
  return Promise.race([
    painted,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, capMs);
    }),
  ]);
}
