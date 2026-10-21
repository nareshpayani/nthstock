import { createFileRoute } from '@tanstack/react-router';
import { GuidePage } from '@/features/guide';

// Public: reviewers read it before (or without) logging in.
export const Route = createFileRoute('/_app/guide')({
  component: GuidePage,
});
