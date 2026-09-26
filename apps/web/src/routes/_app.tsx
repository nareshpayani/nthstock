import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '@/app/layouts/AppShell';
import { ensureSession } from '@/shared/lib/sessionClient';

function AppLayout() {
  return (
    <AppShell>
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
