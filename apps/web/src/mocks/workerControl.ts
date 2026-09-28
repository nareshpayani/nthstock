// A hard reload (Cmd+Shift+R) loads the page without its service worker, and the browser keeps
// it that way until the next normal load. MSW still starts, but every /v1 call then goes to the
// Vite server and 404s, so each dashboard card shows "unavailable" and Retry never recovers.
// One normal reload hands the page back to the worker.

/** sessionStorage flag so a page the worker never controls reloads once, not forever. */
export const WORKER_RELOAD_KEY = 'nthstock:msw-control-reload';

export type WorkerControl = 'controlled' | 'reloading' | 'uncontrolled' | 'unsupported';

export type WorkerControlEnv = {
  serviceWorker: Pick<ServiceWorkerContainer, 'controller'> | undefined;
  reload: () => void;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
};

export function ensureWorkerControl(env: WorkerControlEnv): WorkerControl {
  if (!env.serviceWorker) return 'unsupported';
  if (env.serviceWorker.controller) {
    env.storage?.removeItem(WORKER_RELOAD_KEY);
    return 'controlled';
  }
  if (env.storage && !env.storage.getItem(WORKER_RELOAD_KEY)) {
    env.storage.setItem(WORKER_RELOAD_KEY, '1');
    env.reload();
    return 'reloading';
  }
  console.error(
    '[MSW] The mock worker does not control this page, so /v1 requests will fail. Reload the page.',
  );
  return 'uncontrolled';
}
