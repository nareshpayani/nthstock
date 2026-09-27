import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { PortfolioPage, holdingsQuery, type PortfolioSearch } from '@/features/holdings';

// Holdings sort URL state (ADR 0005). An invalid value is dropped rather than failing the route.
// Kept here, not imported from the feature, so the feature's code stays out of the initial chunk.
const portfolioSearch = z.object({
  key: z
    .enum(['symbol', 'qty', 'avgPrice', 'ltp', 'currentValue', 'pnl', 'pnlBp'])
    .optional()
    .catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/_authed/portfolio')({
  validateSearch: (search: Record<string, unknown>) => portfolioSearch.parse(search),
  // Starts the holdings request with the route chunk; the page shows its own loading rows.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(holdingsQuery(context.apiClient));
  },
  codeSplitGroupings: [['loader', 'component']],
  component: PortfolioRoute,
});

function PortfolioRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Sorting replaces the history entry: it is a view of one page.
  const setSearch = (patch: PortfolioSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  return <PortfolioPage search={search} onSearchChange={setSearch} />;
}
