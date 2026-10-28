import type { Session } from '@nthstock/contracts';
import { create } from 'zustand';
import { safeStorage } from './safeStorage';

/**
 * - `unknown`: nothing checked yet this page load (a refresh cookie may still hold a session);
 * - `authenticated`: a session is held in memory;
 * - `anonymous`: no session (never logged in, logged out, or the refresh failed).
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

/**
 * The session (T-089), in memory only: the access token and CSRF token never touch storage, and a
 * reload gets them back from `POST /v1/auth/refresh` with the httpOnly refresh cookie.
 */
export type SessionState = {
  status: SessionStatus;
  session: Session | null;
  setSession: (session: Session) => void;
  clearSession: () => void;
};

export const initialSessionState = { status: 'unknown' as SessionStatus, session: null };

/**
 * Whether this browser may hold a refresh cookie: `none` once a refresh failed or the user logged
 * out, `held` once a session was set. It holds no secret, only lets a page load skip the refresh
 * that would answer 401 (an error in the console) when it is known there is no session. A missing
 * or unreadable hint means "try", so a session is never lost for want of it.
 */
export const SESSION_HINT_KEY = 'nthstock.sessionHint';

export const knownSignedOut = () => safeStorage.get(SESSION_HINT_KEY) === 'none';

/**
 * msw mode (CR-T19): the mock backend lives in this browser, so a mock session exists only after
 * this browser signed in, which sets the hint. A browser with no hint at all (a first visit) is
 * marked signed out, and the login page paints without waiting for the mock chunk only to hear
 * 401. Not for `?demo=1`, which signs in through that refresh.
 */
export function assumeSignedOutWithoutHint() {
  if (safeStorage.get(SESSION_HINT_KEY) === null) safeStorage.set(SESSION_HINT_KEY, 'none');
}

export const useSessionStore = create<SessionState>()((set) => ({
  ...initialSessionState,
  setSession: (session) => {
    safeStorage.set(SESSION_HINT_KEY, 'held');
    set({ status: 'authenticated', session });
  },
  clearSession: () => {
    safeStorage.set(SESSION_HINT_KEY, 'none');
    set({ status: 'anonymous', session: null });
  },
}));
