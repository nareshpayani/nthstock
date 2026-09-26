import type { ApiClient } from '@nthstock/apiClient';
import { redirect } from '@tanstack/react-router';
import { ensureSession } from './sessionClient';

/**
 * Route guard for pages that need a session (T-089). Use in `beforeLoad`: restores the session
 * with one refresh if needed, otherwise redirects to `/login?redirect=<where the user was going>`.
 */
export async function requireSession({
  context,
  location,
}: {
  context: { apiClient: ApiClient };
  location: { href: string };
}): Promise<void> {
  const session = await ensureSession(context.apiClient);
  if (!session) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}
