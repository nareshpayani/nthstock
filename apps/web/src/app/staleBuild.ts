/**
 * Recovery from a stale build. Every deploy replaces the hashed chunks in /assets, so a tab opened
 * before a deploy (or one whose chunk fetch failed while the network dropped) can no longer load
 * the code for the next page. A failed dynamic import stays failed for the life of the document,
 * so "Try again" in the route boundary cannot help: only a full reload, which fetches the current
 * index.html and its chunks, can. This reloads at most once a minute, so a site that is really down
 * shows the error card instead of a reload loop.
 */

const KEY = 'nthstock:staleBuildReloadAt';
const MIN_GAP_MS = 60_000;

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i;

/** True when an error means a code chunk could not be loaded (Chrome, Firefox, Safari wording). */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR.test(error.message);
}

export type StaleBuildEnv = {
  reload: () => void;
  /** False while the browser is offline: a reload then would show the browser's offline page. */
  online: () => boolean;
  /** Calls `run` once when the browser is back online. */
  whenOnline: (run: () => void) => void;
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  now: () => number;
};

function defaultEnv(): StaleBuildEnv {
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = undefined;
  }
  return {
    reload: () => {
      window.location.reload();
    },
    online: () => navigator.onLine,
    whenOnline: (run) => {
      window.addEventListener('online', run, { once: true });
    },
    storage,
    now: () => Date.now(),
  };
}

/**
 * Reloads the page to pick up the current build, unless it already did so in the last minute.
 * Returns whether it reloaded (or will, once back online). Offline, it waits for the network, so
 * the tab does not land on the browser's offline page. Without session storage it still reloads,
 * since one reload is the only way out and the browser's own reload limits stop a loop.
 */
export function reloadForNewBuild(env: StaleBuildEnv = defaultEnv()): boolean {
  if (!env.online()) {
    env.whenOnline(() => {
      reloadForNewBuild(env);
    });
    return true;
  }
  let last: number;
  try {
    last = Number(env.storage?.getItem(KEY) ?? 0);
  } catch {
    last = 0;
  }
  const now = env.now();
  if (now - last < MIN_GAP_MS) return false;
  try {
    env.storage?.setItem(KEY, String(now));
  } catch {
    // A convenience only: the reload still happens.
  }
  env.reload();
  return true;
}

/**
 * Vite fires `vite:preloadError` when a chunk's preload fails. Reload to the current build instead
 * of letting the import throw into a route's error boundary.
 */
export function installStaleBuildReload(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
