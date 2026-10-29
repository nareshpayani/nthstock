import type { AnyRoute, AnyRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

/** The longest the mock worker waits for the first page to paint (NSTOCK-0469). */
export const FIRST_PAINT_CAP_MS = 1000;

let markPainted: () => void = () => undefined;
const painted = new Promise<void>((resolve) => {
  markPainted = resolve;
});

/**
 * Marks the first screen as painted, from the frame after its first commit (NSTOCK-0469). The app
 * shell and the login page call it: they are what a cold load shows first.
 */
export function useMarkFirstPaint(): void {
  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(markPainted, 0);
    });
  }, []);
}

/** Resolves after the browser has painted the frames that follow now. */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    // A frame for React to commit what just loaded, a frame to paint it, then a task after it.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0);
      });
    });
  });

/**
 * Resolves once the first screen has painted and the code of every route the URL matches has
 * loaded and painted too, or after `capMs` at most. msw mode starts the mock worker here instead
 * of at boot (NSTOCK-0469): building the mock market is about 300 ms of main-thread work, and run
 * beside the first render it held the header, rail and hero back. Only route code is awaited,
 * never a loader, because a loader may itself wait for the mock worker.
 */
export function afterFirstPaint(
  router: AnyRouter,
  capMs: number = FIRST_PAINT_CAP_MS,
): Promise<void> {
  const routes = router.routesById as Record<string, AnyRoute | undefined>;
  const chunks = router.matchRoutes(router.latestLocation).map((match) => {
    const route = routes[match.routeId];
    return route ? router.loadRouteChunk(route) : undefined;
  });
  const ready = Promise.all([painted, Promise.allSettled(chunks)]).then(nextPaint);
  return Promise.race([
    ready,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, capMs);
    }),
  ]);
}
