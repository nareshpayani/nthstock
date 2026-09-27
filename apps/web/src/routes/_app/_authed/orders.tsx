import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { OrdersPage, orderBookQuery, type OrdersSearch } from '@/features/orders';

// Order book URL state (ADR 0005): the tab and the order open in the detail drawer. An invalid
// value is dropped rather than failing the route. Kept here, not imported from the feature, so the
// feature's code stays out of the initial chunk.
const ordersSearch = z.object({
  tab: z.enum(['open', 'executed', 'cancelled']).optional().catch(undefined),
  order: z.string().min(1).max(64).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/_authed/orders')({
  validateSearch: (search: Record<string, unknown>) => ordersSearch.parse(search),
  // Starts the order book request with the route chunk; the page shows its own loading rows.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(orderBookQuery(context.apiClient));
  },
  codeSplitGroupings: [['loader', 'component']],
  component: OrdersRoute,
});

function OrdersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Tabs and the drawer replace the history entry: they are views of one page.
  const setSearch = (patch: OrdersSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  return <OrdersPage search={search} onSearchChange={setSearch} />;
}
