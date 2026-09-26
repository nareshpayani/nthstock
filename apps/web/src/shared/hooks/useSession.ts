import { useSessionStore } from '@/shared/lib/sessionStore';

/** The session status and, when logged in, the session (user, device, tokens in memory). */
export function useSession() {
  const status = useSessionStore((s) => s.status);
  const session = useSessionStore((s) => s.session);
  return { status, session };
}
