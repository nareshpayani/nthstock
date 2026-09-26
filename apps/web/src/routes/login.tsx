import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { LoginPage } from '@/features/auth';
import { safeRedirect } from '@/shared/lib/safeRedirect';
import { ensureSession } from '@/shared/lib/sessionClient';

// `?redirect=` is where to go after logging in; the feature only honours in-app paths.
const loginSearch = z.object({ redirect: z.string().max(2048).optional().catch(undefined) });

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => loginSearch.parse(search),
  // Already logged in (or restored by the refresh cookie): skip the form.
  beforeLoad: async ({ context, search }) => {
    if (await ensureSession(context.apiClient)) {
      throw redirect({ href: safeRedirect(search.redirect), replace: true });
    }
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: target } = Route.useSearch();
  return <LoginPage redirect={target} />;
}
