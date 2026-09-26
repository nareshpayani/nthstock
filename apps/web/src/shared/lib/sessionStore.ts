import type { Session } from '@nthstock/contracts';
import { create } from 'zustand';

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

export const useSessionStore = create<SessionState>()((set) => ({
  ...initialSessionState,
  setSession: (session) => set({ status: 'authenticated', session }),
  clearSession: () => set({ status: 'anonymous', session: null }),
}));
