import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { GuidePage } from '@/features/guide';

// Guide URL state (NSTOCK-0341): the open tab, so reviewers can share a link to one topic. Any
// string is kept here and an unknown one shows the first tab, so the feature's tab list stays out
// of the initial chunk.
const guideSearch = z.object({
  tab: z.string().max(64).optional().catch(undefined),
});

// Public: reviewers read it before (or without) logging in.
export const Route = createFileRoute('/_app/guide')({
  validateSearch: (search: Record<string, unknown>) => guideSearch.parse(search),
  component: GuideRoute,
});

function GuideRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <GuidePage
      tab={tab}
      onSelectTab={(next) => void navigate({ search: { tab: next }, replace: true })}
    />
  );
}
