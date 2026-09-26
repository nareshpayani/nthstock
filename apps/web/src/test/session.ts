import type { Session } from '@nthstock/contracts';
import { initialSessionState, useSessionStore } from '@/shared/lib/sessionStore';

const TS = '2026-09-25T04:00:00.000Z';

/** A schema-valid session for tests and stories (a made-up user, no real data). */
export function testSession(
  user: Partial<Session['user']> = {},
  device: Partial<Session['device']> = {},
): Session {
  return {
    user: {
      id: 'usr_test',
      mobileMasked: '******3210',
      name: 'Asha Rao',
      email: null,
      kycStatus: 'VERIFIED',
      pinSet: true,
      totpEnabled: false,
      createdAt: TS,
      ...user,
    },
    device: {
      id: 'dev_test',
      label: 'This browser',
      trusted: true,
      current: true,
      createdAt: TS,
      lastSeenAt: TS,
      ...device,
    },
    accessToken: 'test-access-token',
    accessTokenExpiresAt: '2026-09-25T04:15:00.000Z',
    csrfToken: 'test-csrf-token-0123456789',
  };
}

/** Puts a session in the store, as a login would. */
export function signIn(session: Session = testSession()): Session {
  useSessionStore.getState().setSession(session);
  return session;
}

/** No session, already checked (the "logged out" state). */
export function signOut(): void {
  useSessionStore.getState().clearSession();
}

/** Back to "not checked yet", as on a fresh page load. */
export function resetSession(): void {
  useSessionStore.setState(initialSessionState);
}
