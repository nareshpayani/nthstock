import { createFileRoute, redirect } from '@tanstack/react-router';
import { IsoUtc } from '@nthstock/contracts';
import { z } from 'zod';
import { LoginPage } from '@/features/auth';
import { safeRedirect } from '@/shared/lib/safeRedirect';
import { ensureSession } from '@/shared/lib/sessionClient';

// `?redirect=` is where to go after logging in; the feature only honours in-app paths.
// `?deleted=` is set after deleting the account: the purge date, for the notice.
// `?try=1` is the reviewer link: it starts Try demo without a tap (msw mode only).
const loginSearch = z.object({
  try: z.literal('1').or(z.literal(1)).optional().catch(undefined),
  redirect: z.string().max(2048).optional().catch(undefined),
  deleted: IsoUtc.optional().catch(undefined),
});

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => loginSearch.parse(search),
  // Already logged in (or restored by the refresh cookie): skip the form.
  beforeLoad: async ({ context, search }) => {
    // Just deleted: the app is leaving the account, whatever session it still holds.
    if (search.deleted) return;
    if (await ensureSession(context.apiClient)) {
      throw redirect({ href: safeRedirect(search.redirect), replace: true });
    }
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: target, deleted, try: tryDemo } = Route.useSearch();
  return (
    <LoginPage
      redirect={target}
      deletedPurgeAfter={deleted}
      autoStartDemo={tryDemo !== undefined}
    />
  );
}
