import { getRouteApi } from '@tanstack/react-router';
import { DEFAULT_CHART_RANGE, IndexChartCard } from '@/features/charts';
import { IndicesRow } from '@/features/indices';
import type { DashboardSearch } from '../model/dashboardSearch';
import { Hero } from './Hero';
import { MarketMoversCard } from './MarketMoversCard';
import { StocksListsCard } from './StocksListsCard';

const route = getRouteApi('/_app/dashboard');

export type DashboardPageProps = {
  /** Injected for tests; defaults to now. */
  now?: Date;
};

/** Dashboard in the reference layout: hero, index chart, indices row, lists and movers. */
export function DashboardPage({ now = new Date() }: DashboardPageProps) {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  // Section tabs replace the history entry: switching a tab is not a new page.
  const setSearch = (patch: DashboardSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <Hero now={now} />
      <IndexChartCard
        range={search.range ?? DEFAULT_CHART_RANGE}
        onRangeChange={(range) => setSearch({ range })}
      />
      <IndicesRow />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6 xl:grid-cols-2">
        <StocksListsCard />
        <MarketMoversCard />
      </div>
    </div>
  );
}
