import { CandleRange, MoverDirection, StockListId, TradingSymbol } from '@nthstock/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { DashboardPage, prefetchDashboard } from '@/features/dashboard';

// Dashboard URL state (ADR 0005). Every key is optional and an invalid value is dropped rather
// than failing the route; the sections apply their defaults. Kept here, not imported from the
// feature, so the feature's code stays out of the initial chunk.
const dashboardSearch = z.object({
  range: CandleRange.optional().catch(undefined),
  list: StockListId.optional().catch(undefined),
  movers: MoverDirection.optional().catch(undefined),
  moversIndex: TradingSymbol.optional().catch(undefined),
});

export const Route = createFileRoute('/_app/dashboard')({
  validateSearch: (search: Record<string, unknown>) => dashboardSearch.parse(search),
  loaderDeps: ({ search }) => search,
  // Prefetch every section while rendering starts; not awaited, so one slow or failing section
  // never holds up the page. Split together with the component, out of the initial JS.
  loader: ({ context, deps }) => {
    prefetchDashboard(context.queryClient, context.apiClient, deps);
  },
  codeSplitGroupings: [['loader', 'component']],
  component: DashboardPage,
});
