import type { Session } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/shared/lib/sessionStore';
import { bindTradingSession } from './tradingSession';

type Slice = Pick<SessionState, 'status' | 'session'>;

const sessionOf = (id: string) => ({ user: { id } }) as unknown as Session;

function harness(initial: Slice) {
  let current = initial;
  const listeners = new Set<(state: Slice) => void>();
  const sessions = {
    getState: () => current,
    subscribe(listener: (state: Slice) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (next: Slice) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  let visibility: DocumentVisibilityState = 'visible';
  let onVisibility: () => void = () => undefined;
  const document = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_: 'visibilitychange', listener: () => void) => {
      onVisibility = listener;
    },
    removeEventListener: vi.fn(),
  };
  const setVisibility = (next: DocumentVisibilityState) => {
    visibility = next;
    onVisibility();
  };
  let status: 'idle' | 'ready' = 'idle';
  const store = {
    start: vi.fn(() => {
      status = 'ready';
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      status = 'idle';
    }),
    resync: vi.fn(() => Promise.resolve()),
    getState: () =>
      ({ status }) as ReturnType<Parameters<typeof bindTradingSession>[0]['store']['getState']>,
  };
  const stop = bindTradingSession({ store, sessions, document });
  return { store, set, setVisibility, stop, document };
}

describe('bindTradingSession (T10)', () => {
  it('starts for a signed-in user, clears on sign-out and on a change of user', () => {
    const t = harness({ status: 'unknown', session: null });
    expect(t.store.start).not.toHaveBeenCalled();
    t.set({ status: 'authenticated', session: sessionOf('u1') });
    expect(t.store.start).toHaveBeenCalledTimes(1);
    // A refreshed session for the same user changes nothing.
    t.set({ status: 'authenticated', session: sessionOf('u1') });
    expect(t.store.start).toHaveBeenCalledTimes(1);
    t.set({ status: 'authenticated', session: sessionOf('u2') });
    expect(t.store.clear).toHaveBeenCalledTimes(1);
    expect(t.store.start).toHaveBeenCalledTimes(2);
    t.set({ status: 'anonymous', session: null });
    expect(t.store.clear).toHaveBeenCalledTimes(2);
  });

  it('re-reads the account when the tab comes back, only while signed in', () => {
    const t = harness({ status: 'authenticated', session: sessionOf('u1') });
    expect(t.store.start).toHaveBeenCalledTimes(1);
    t.setVisibility('hidden');
    expect(t.store.resync).not.toHaveBeenCalled();
    t.setVisibility('visible');
    expect(t.store.resync).toHaveBeenCalledTimes(1);
    t.set({ status: 'anonymous', session: null });
    t.setVisibility('visible');
    expect(t.store.resync).toHaveBeenCalledTimes(1);
    t.stop();
    expect(t.document.removeEventListener).toHaveBeenCalled();
  });
});
