import { afterEach, describe, expect, it } from 'vitest';
import {
  SOCKET_GRACE_MS,
  isOffline,
  startConnectivity,
  useConnectivityStore,
} from './connectivity';

type Status = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

function harness(onLine = true) {
  const target = new EventTarget();
  let listener: (status: Status) => void = () => undefined;
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let next = 0;
  let clock = 1_000;
  const stop = startConnectivity({
    target: target as unknown as Window,
    navigator: { onLine },
    socket: {
      onStatus: (fn) => {
        listener = fn;
        return () => undefined;
      },
    },
    timers: {
      setTimeout: (callback, ms) => {
        delays.push(ms);
        next += 1;
        pending.set(next, callback);
        return next;
      },
      clearTimeout: (handle) => pending.delete(handle as number),
    },
    now: () => clock,
  });
  return {
    target,
    status: (status: Status) => listener(status),
    elapse: () => {
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        callback();
      }
    },
    delays,
    pending: () => pending.size,
    advance: (ms: number) => (clock += ms),
    stop,
  };
}
const offline = () => isOffline(useConnectivityStore.getState());

afterEach(() => {
  useConnectivityStore.setState({
    browserOffline: false,
    socketDown: false,
    since: null,
    forced: 'live',
  });
});

describe('connectivity (CR-T18, SPEC-CR-1 §7)', () => {
  it('follows the browser going offline and back, with the time it was lost', () => {
    const h = harness();
    expect(offline()).toBe(false);
    h.target.dispatchEvent(new Event('offline'));
    expect(offline()).toBe(true);
    expect(useConnectivityStore.getState().since).toBe(1_000);
    h.target.dispatchEvent(new Event('online'));
    expect(offline()).toBe(false);
    expect(useConnectivityStore.getState().since).toBeNull();
    h.stop();
  });

  it('starts offline when the browser already is', () => {
    harness(false).stop();
    expect(offline()).toBe(true);
  });

  it(`counts the socket as down only after ${String(SOCKET_GRACE_MS)} ms of reconnecting`, () => {
    const h = harness();
    h.status('open');
    h.status('reconnecting');
    expect(offline()).toBe(false);
    // A reconnect inside the grace period never shows offline.
    h.status('open');
    h.elapse();
    expect(offline()).toBe(false);
    h.status('reconnecting');
    h.advance(SOCKET_GRACE_MS);
    h.elapse();
    expect(offline()).toBe(true);
    h.status('open');
    expect(offline()).toBe(false);
    h.stop();
  });

  it('arms the grace timer for exactly SOCKET_GRACE_MS', () => {
    const h = harness();
    h.status('reconnecting');
    expect(h.delays).toEqual([SOCKET_GRACE_MS]);
    h.stop();
  });

  it.each<Status>(['closed', 'idle', 'open'])(
    'a %s status during the grace period cancels it',
    (status) => {
      const h = harness();
      h.status('reconnecting');
      expect(h.pending()).toBe(1);
      h.status(status);
      expect(h.pending()).toBe(0);
      h.elapse();
      expect(offline()).toBe(false);
      h.stop();
    },
  );

  it('the demo can force offline, and lifting it goes back online', () => {
    useConnectivityStore.getState().setForced('offline');
    expect(offline()).toBe(true);
    expect(useConnectivityStore.getState().since).not.toBeNull();
    useConnectivityStore.getState().setForced('live');
    expect(offline()).toBe(false);
    expect(useConnectivityStore.getState().since).toBeNull();
  });
});
