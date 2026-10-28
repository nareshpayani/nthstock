import { create } from 'zustand';

/**
 * What a part of the instrument page shows (SPEC-CR-1 §7). `live` is the normal page; the others
 * are forced from the demo Simulator's "States" row so each state can be seen on demand (CR-11).
 */
export type PageState = 'live' | 'loading' | 'empty' | 'error' | 'offline';
export const PAGE_STATES: readonly PageState[] = ['live', 'loading', 'empty', 'error', 'offline'];

/** The realtime socket counts as down only after this long, so a blip does not flash "offline". */
export const SOCKET_GRACE_MS = 3_000;

export type ConnectivityState = {
  /** The browser says it has no network. */
  browserOffline: boolean;
  /** The realtime socket has been reconnecting for longer than the grace period. */
  socketDown: boolean;
  /** When the connection was last lost (epoch ms), for "Stale · as of 10:42". */
  since: number | null;
  /** The state forced from the demo "States" row; `live` when nothing is forced. */
  forced: PageState;
  setForced: (state: PageState) => void;
};

export const useConnectivityStore = create<ConnectivityState>()((set) => ({
  browserOffline: false,
  socketDown: false,
  since: null,
  forced: 'live',
  setForced: (forced) =>
    set((state) => {
      const offline = state.browserOffline || state.socketDown || forced === 'offline';
      return { forced, since: offline ? (state.since ?? Date.now()) : null };
    }),
}));

/**
 * Offline (SPEC-CR-1 §7): the browser reports offline, the realtime socket has been down for more
 * than 3 seconds, or the demo forces it.
 */
export const isOffline = (state: ConnectivityState): boolean =>
  state.browserOffline || state.socketDown || state.forced === 'offline';

/** True while offline; components re-render only when that flips. */
export function useOffline(): boolean {
  return useConnectivityStore(isOffline);
}

/** The state the demo forces on the page, `live` when none. */
export function useForcedState(): PageState {
  return useConnectivityStore((state) => state.forced);
}

type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/**
 * Follows the browser's online events and the realtime socket's status into the store. Returns a
 * function that stops following.
 */
export function startConnectivity({
  target,
  navigator: nav,
  socket,
  timers = {
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  },
  now = Date.now,
}: {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  navigator: Pick<Navigator, 'onLine'>;
  socket: { onStatus: (listener: (status: SocketStatus) => void) => () => void };
  timers?: Timers;
  now?: () => number;
}): () => void {
  const store = useConnectivityStore;
  const lost = () => store.getState().since ?? now();
  const update = (patch: Partial<Pick<ConnectivityState, 'browserOffline' | 'socketDown'>>) => {
    const offline = isOffline({ ...store.getState(), ...patch });
    store.setState({ ...patch, since: offline ? lost() : null });
  };
  update({ browserOffline: !nav.onLine });
  const onOnline = () => update({ browserOffline: false });
  const onOffline = () => update({ browserOffline: true });
  target.addEventListener('online', onOnline);
  target.addEventListener('offline', onOffline);
  let grace: unknown = null;
  const stopSocket = socket.onStatus((status) => {
    if (status === 'reconnecting') {
      if (grace === null && !store.getState().socketDown) {
        grace = timers.setTimeout(() => {
          grace = null;
          update({ socketDown: true });
        }, SOCKET_GRACE_MS);
      }
      return;
    }
    if (grace !== null) timers.clearTimeout(grace);
    grace = null;
    if (status === 'open' && store.getState().socketDown) update({ socketDown: false });
  });
  return () => {
    target.removeEventListener('online', onOnline);
    target.removeEventListener('offline', onOffline);
    if (grace !== null) timers.clearTimeout(grace);
    stopSocket();
  };
}
