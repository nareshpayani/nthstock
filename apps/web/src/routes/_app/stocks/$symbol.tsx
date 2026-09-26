import { CandleRange, Exchange } from '@nthstock/contracts';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import {
  StockDetailPage,
  StockNotFound,
  loadStockDetail,
  type StockDetailSearch,
} from '@/features/stockDetail';

// Stock detail URL state (ADR 0005): chart range, exchange and chart type. An invalid value is
// dropped rather than failing the route. Kept here, not imported from the feature, so the
// feature's code stays out of the initial chunk.
const stockSearch = z.object({
  range: CandleRange.optional().catch(undefined),
  exchange: Exchange.optional().catch(undefined),
  chart: z.enum(['area', 'candle']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/stocks/$symbol')({
  validateSearch: (search: Record<string, unknown>) => stockSearch.parse(search),
  // Symbols are upper case: /stocks/infy becomes /stocks/INFY (same page, one canonical URL).
  beforeLoad: ({ params, search }) => {
    const symbol = params.symbol.toUpperCase();
    if (symbol !== params.symbol) {
      throw redirect({ to: '/stocks/$symbol', params: { symbol }, search, replace: true });
    }
  },
  loaderDeps: ({ search }) => ({ exchange: search.exchange, range: search.range }),
  // Waits for the instrument only (T-105); quote, stats and candles load in parallel.
  loader: async ({ context, params, deps }) => {
    const instrument = await loadStockDetail(context.queryClient, context.apiClient, {
      symbol: params.symbol,
      ...deps,
    });
    if (!instrument) throw notFound({ data: { symbol: params.symbol } });
    return instrument;
  },
  codeSplitGroupings: [['loader', 'component', 'notFoundComponent']],
  component: StockRoute,
  notFoundComponent: ({ data }) => <StockNotFound symbol={symbolOf(data)} />,
});

const symbolOf = (data: unknown) =>
  typeof data === 'object' && data !== null && 'symbol' in data && typeof data.symbol === 'string'
    ? data.symbol
    : '';

function StockRoute() {
  const instrument = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Chart tabs replace the history entry: switching range is not a new page.
  const setSearch = (patch: StockDetailSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  return <StockDetailPage instrument={instrument} search={search} onSearchChange={setSearch} />;
}
