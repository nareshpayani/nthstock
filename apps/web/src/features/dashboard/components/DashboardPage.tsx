import { Hero } from './Hero';
import { IndexChartCard } from './IndexChartCard';
import { IndicesRow } from './IndicesRow';
import { MarketMoversCard } from './MarketMoversCard';
import { StocksListsCard } from './StocksListsCard';

export type DashboardPageProps = {
  /** Injected for tests; defaults to now. */
  now?: Date;
};

/** Dashboard in the reference layout: hero, index chart, indices row, lists and movers. */
export function DashboardPage({ now = new Date() }: DashboardPageProps) {
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <Hero now={now} />
      <IndexChartCard />
      <IndicesRow />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6 xl:grid-cols-2">
        <StocksListsCard />
        <MarketMoversCard />
      </div>
    </div>
  );
}
