import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '@/app/layouts/AppShell';

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export const Route = createFileRoute('/_app')({ component: AppLayout });
