import { Navigate, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useSession } from '@/shared/hooks/useSession';

/**
 * Keeps a guarded page guarded after it has loaded: when the session ends (logout in another
 * component, or the one silent refresh failed), it goes to /login with a redirect back here.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  // The page on screen (the resolved location), not a navigation already under way.
  const here = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).href });
  if (status !== 'anonymous') return children;
  if (here.startsWith('/login')) return null;
  return <Navigate to="/login" search={{ redirect: here }} replace />;
}
