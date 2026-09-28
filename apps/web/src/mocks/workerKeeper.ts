/**
 * Keeps this tab registered with the MSW service worker (msw mode only).
 *
 * Chrome stops an idle service worker (a sleeping laptop, a long background tab) and starts a
 * fresh one on the next request. MSW's worker keeps the tabs it mocks for in memory, so the fresh
 * one knows none and lets every /v1 request through to the dev server: every section then shows
 * its "unavailable" error until a reload. `ensureActive` re-sends MSW's own `MOCK_ACTIVATE`
 * handshake and waits for `MOCKING_ENABLED` (idempotent in the worker), so a request that follows
 * it is mocked again. The REST client calls it before every request (requests made together
 * share one handshake), since a worker can stop at any moment; waking the tab calls it too.
 */

/** Without a reply (no controller yet, a worker still starting) the request goes ahead anyway. */
export const HANDSHAKE_TIMEOUT_MS = 1_000;

export type WorkerKeeperEnv = {
  serviceWorker: Pick<
    ServiceWorkerContainer,
    'controller' | 'addEventListener' | 'removeEventListener'
  >;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type WorkerKeeper = {
  /** Resolves once the worker has confirmed this tab (or after a short timeout). Never rejects. */
  ensureActive: () => Promise<void>;
};

export function createWorkerKeeper(env: WorkerKeeperEnv): WorkerKeeper {
  let inFlight: Promise<void> | null = null;

  const handshake = () =>
    new Promise<void>((resolve) => {
      const controller = env.serviceWorker.controller;
      if (!controller) {
        resolve();
        return;
      }
      const done = () => {
        env.clearTimeout(timer);
        env.serviceWorker.removeEventListener('message', onMessage);
        resolve();
      };
      const onMessage = (event: Event) => {
        const data: unknown = (event as MessageEvent).data;
        if (
          typeof data === 'object' &&
          data !== null &&
          Reflect.get(data, 'type') === 'MOCKING_ENABLED'
        ) {
          done();
        }
      };
      const timer = env.setTimeout(done, HANDSHAKE_TIMEOUT_MS);
      env.serviceWorker.addEventListener('message', onMessage);
      controller.postMessage('MOCK_ACTIVATE');
    });

  return {
    ensureActive() {
      inFlight ??= handshake().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

/** The browser's keeper; also re-checks when the tab becomes visible, regains focus or goes online. */
export function startWorkerKeeper(): WorkerKeeper {
  const keeper = createWorkerKeeper({
    serviceWorker: navigator.serviceWorker,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      window.clearTimeout(handle as number);
    },
  });
  const wake = () => {
    if (document.visibilityState === 'visible') void keeper.ensureActive();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  return keeper;
}
