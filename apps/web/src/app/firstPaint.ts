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

/** Resolves after the browser has painted the frames that follow now and gone idle. */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    // A frame for React to commit what just loaded, a frame to paint it, then the first idle
    // moment after it (Safari has no requestIdleCallback, so a task there).
    const idle = () => {
      if (typeof window.requestIdleCallback === 'function')
        window.requestIdleCallback(() => resolve(), { timeout: 300 });
      else window.setTimeout(resolve, 0);
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(idle);
    });
  });

/**
 * Resolves on the first frame where the router has settled: the page is shown, or a route is
 * waiting on its loader's data (which may itself wait for the mock worker).
 */
const settled = (router: AnyRouter) =>
  new Promise<void>((resolve) => {
    const check = () => {
      const { status, matches } = router.state;
      const waitingOnData = matches.some(
        (match) => match.status === 'pending' && match.isFetching === 'loader',
      );
      if (status === 'idle' || waitingOnData) resolve();
      else window.requestAnimationFrame(check);
    };
    check();
  });

/**
 * Resolves once the first screen has painted, the code of every route the URL matches has loaded,
 * and the router has settled and painted, or after `capMs` at most. msw mode starts the mock
 * worker here instead of at boot (NSTOCK-0469): building the mock market is about 300 ms of
 * main-thread work, and run beside the first render it held the header, rail and hero back. Only
 * route code is awaited, never a loader, because a loader may itself wait for the mock worker.
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
  const ready = Promise.all([painted, Promise.allSettled(chunks)])
    .then(() => settled(router))
    .then(nextPaint);
  return Promise.race([
    ready,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, capMs);
    }),
  ]);
}
