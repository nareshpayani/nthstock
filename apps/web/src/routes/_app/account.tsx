import { createFileRoute } from '@tanstack/react-router';
import { AccountPage } from '@/features/account';

// The phone app's Account tab (NSTOCK-0466). Public: signed out, it asks to log in.
export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
});
