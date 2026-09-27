import { createFileRoute } from '@tanstack/react-router';
import { FundsPage, fundsLedgerQuery, fundsSummaryQuery } from '@/features/funds';

export const Route = createFileRoute('/_app/_authed/funds')({
  // Starts the summary and the first ledger page with the route chunk; the page shows its own
  // loading rows.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(fundsSummaryQuery(context.apiClient));
    void context.queryClient.prefetchInfiniteQuery(fundsLedgerQuery(context.apiClient));
  },
  codeSplitGroupings: [['loader', 'component']],
  component: FundsPage,
});
