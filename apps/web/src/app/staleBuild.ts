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
  warn: (message: string) => void;
};

/** One reload waits for the network at a time, however many chunk errors arrive offline. */
let waitingForNetwork = false;

export function defaultStaleBuildEnv(): StaleBuildEnv {
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
    warn: (message) => {
      console.warn(message);
    },
  };
}

/**
 * Reloads now, or once the browser is back online, so the tab never lands on the browser's offline
 * page. Returns true, since a reload either ran or is queued. The queued one has no once-a-minute
 * guard, so it always recovers the tab; this is also Try again's reload.
 */
export function reloadWhenOnline(env: StaleBuildEnv = defaultStaleBuildEnv()): boolean {
  if (env.online()) {
    env.reload();
    return true;
  }
  if (!waitingForNetwork) {
    waitingForNetwork = true;
    env.whenOnline(() => {
      waitingForNetwork = false;
      env.reload();
    });
  }
  return true;
}

/**
 * Reloads the page to pick up the current build, unless it already did so in the last minute.
 * Offline, the reload waits for the network. Returns whether a reload ran or is queued; false
 * means the error should still reach the route's error card. Without working session storage
 * nothing can record the reload, so it never reloads by itself (that could loop); the card's
 * Try again still does.
 */
export function reloadForNewBuild(env: StaleBuildEnv = defaultStaleBuildEnv()): boolean {
  const now = env.now();
  try {
    if (!env.storage) throw new Error('no session storage');
    const last = Number(env.storage.getItem(KEY) ?? 0);
    if (Number.isFinite(last) && now - last < MIN_GAP_MS) {
      env.warn('A code chunk failed to load again within a minute of reloading; not reloading.');
      return false;
    }
    env.storage.setItem(KEY, String(now));
  } catch {
    env.warn('A code chunk failed to load and session storage is unavailable; not reloading.');
    return false;
  }
  return reloadWhenOnline(env);
}

/**
 * Vite fires `vite:preloadError` when a chunk's preload fails. Reload to the current build instead
 * of letting the import throw. Offline the error is swallowed too, with the reload queued: thrown,
 * it would reach TanStack Router's own reload, which would land on the browser's offline page.
 * When the minute's reload is spent, the error goes on to the route's card.
 */
export function installStaleBuildReload(
  target: Pick<Window, 'addEventListener'> = window,
  env: StaleBuildEnv = defaultStaleBuildEnv(),
): void {
  target.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild(env)) event.preventDefault();
  });
}
