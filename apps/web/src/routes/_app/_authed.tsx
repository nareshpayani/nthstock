import { createFileRoute, Outlet } from '@tanstack/react-router';
import { RequireSession } from '@/features/auth';
import { requireSession } from '@/shared/lib/requireSession';

function AuthedLayout() {
  return (
    <RequireSession>
      <Outlet />
    </RequireSession>
  );
}

// Pages with the user's own data (orders, positions, portfolio, funds) need a session (T-089):
// without one they go to /login?redirect=<the page>. Market pages stay public.
export const Route = createFileRoute('/_app/_authed')({
  beforeLoad: requireSession,
  component: AuthedLayout,
});
