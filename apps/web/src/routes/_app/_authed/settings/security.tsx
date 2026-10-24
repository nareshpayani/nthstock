import { createFileRoute } from '@tanstack/react-router';
import { SecurityPage } from '@/features/security';

// Security settings (NSTOCK-0221): two-factor authentication behind a step-up.
export const Route = createFileRoute('/_app/_authed/settings/security')({
  component: SecurityPage,
});
