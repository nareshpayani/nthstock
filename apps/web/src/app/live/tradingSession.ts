import type { TradingStore } from '@nthstock/apiClient';
import type { SessionState } from '@/shared/lib/sessionStore';
import type { VisibilityDocument } from './visibilitySync';

export type TradingSessionOptions = {
  store: Pick<TradingStore, 'start' | 'clear' | 'resync' | 'getState'>;
  /** The session store (zustand); read now and on every change. */
  sessions: {
    getState(): Pick<SessionState, 'status' | 'session'>;
    subscribe(listener: (state: Pick<SessionState, 'status' | 'session'>) => void): () => void;
  };
  document?: VisibilityDocument;
};

/**
 * Ties the trading store to the session (SPEC-TFC-1 §10.1): it loads the account when a user signs
 * in (or the app starts signed in), forgets it on sign-out or a change of user, and re-reads it
 * when the tab comes back, since frames may have been missed while it slept. Returns the stop.
 */
export function bindTradingSession({ store, sessions, document }: TradingSessionOptions) {
  let userId: string | null = null;
  const apply = (state: Pick<SessionState, 'status' | 'session'>) => {
    const next = state.status === 'authenticated' ? (state.session?.user.id ?? null) : null;
    if (next === userId) return;
    if (userId !== null) store.clear();
    userId = next;
    if (next !== null) void store.start();
  };
  apply(sessions.getState());
  const unsubscribe = sessions.subscribe(apply);

  const onVisibility = () => {
    if (document?.visibilityState === 'visible' && store.getState().status === 'ready') {
      void store.resync();
    }
  };
  document?.addEventListener('visibilitychange', onVisibility);
  return () => {
    unsubscribe();
    document?.removeEventListener('visibilitychange', onVisibility);
  };
}
