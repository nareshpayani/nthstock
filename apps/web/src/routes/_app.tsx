import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { AppShell } from '@/app/layouts/AppShell';
import { ensureSession } from '@/shared/lib/sessionClient';

function AppLayout() {
  // The guide brings its own side navigation (its topics) in place of the watchlist rail.
  const isGuide = useRouterState({ select: (state) => state.location.pathname === '/guide' });
  return (
    <AppShell rail={!isGuide}>
      <Outlet />
    </AppShell>
  );
}

export const Route = createFileRoute('/_app')({
  // Restore the session (one refresh) for the header without holding up public pages.
  beforeLoad: ({ context }) => {
    void ensureSession(context.apiClient);
  },
  component: AppLayout,
});
