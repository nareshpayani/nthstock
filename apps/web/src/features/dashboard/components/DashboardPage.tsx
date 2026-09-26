import { getRouteApi } from '@tanstack/react-router';
import { useContext, type ReactNode } from 'react';
import { DEFAULT_CHART_RANGE, IndexChartCard } from '@/features/charts';
import { StocksListsCard } from '@/features/collections';
import { IndicesRow } from '@/features/indices';
import { DEFAULT_MOVERS_DIRECTION, MarketMoversCard } from '@/features/movers';
import { SectionBoundary } from '@/shared/components/SectionBoundary';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';
import type { DashboardSearch } from '../model/dashboardSearch';
import { strings } from '../strings';
import { Hero } from './Hero';

const route = getRouteApi('/_app/dashboard');

export type DashboardPageProps = {
  /** Injected for tests; defaults to the market session clock (the system clock in the app). */
  now?: Date;
};

/** One dashboard section behind its own error boundary (T-099). */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SectionBoundary
      label={label}
      title={strings.sectionError.title}
      description={strings.sectionError.body}
      retryLabel={strings.sectionError.retry}
    >
      {children}
    </SectionBoundary>
  );
}

/**
 * Dashboard in the reference layout (T-093): hero, index chart, indices row, lists and movers.
 * Each section loads, fails and retries on its own: its own skeleton while loading, its own
 * ErrorState when its request fails, and an error boundary so a crash stays inside it (T-099).
 */
export function DashboardPage({ now }: DashboardPageProps) {
  const { clock } = useContext(MarketSessionContext);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  // Section tabs replace the history entry: switching a tab is not a new page.
  const setSearch = (patch: DashboardSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <Hero now={now ?? clock.now()} />
      <Section label={strings.sections.chart}>
        <IndexChartCard
          range={search.range ?? DEFAULT_CHART_RANGE}
          onRangeChange={(range) => setSearch({ range })}
        />
      </Section>
      <Section label={strings.sections.indices}>
        <IndicesRow />
      </Section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6 xl:grid-cols-2">
        <Section label={strings.sections.lists}>
          <StocksListsCard listId={search.list} onListChange={(list) => setSearch({ list })} />
        </Section>
        <Section label={strings.sections.movers}>
          <MarketMoversCard
            index={search.moversIndex}
            direction={search.movers ?? DEFAULT_MOVERS_DIRECTION}
            onIndexChange={(moversIndex) => setSearch({ moversIndex })}
            onDirectionChange={(movers) => setSearch({ movers })}
          />
        </Section>
      </div>
    </div>
  );
}
