import { createFileRoute } from '@tanstack/react-router';
import { PositionsPage, positionsQuery } from '@/features/positions';

export const Route = createFileRoute('/_app/_authed/positions')({
  // Starts the positions request with the route chunk; the page shows its own loading rows.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(positionsQuery(context.apiClient));
  },
  codeSplitGroupings: [['loader', 'component']],
  component: PositionsPage,
});
