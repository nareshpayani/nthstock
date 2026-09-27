import type { Holding } from '@nthstock/contracts';
import { EmptyState, ErrorState, IconBriefcase } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchStocksButton } from '@/shared/components/SearchStocksButton';
import { SkeletonRows } from '@/shared/components/SkeletonRows';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { holdingsQuery } from '../api/holdingsQuery';
import { useLiveHoldings } from '../hooks/useLiveHoldings';
import { DEFAULT_HOLDINGS_SORT, type HoldingsSort } from '../model/holdingsSort';
import { strings } from '../strings';
import { HoldingsTable } from './HoldingsTable';
import { PortfolioSummaryCard } from './PortfolioSummaryCard';

/** Portfolio's URL state (ADR 0005): the holdings sort column and direction. */
export type PortfolioSearch = {
  key?: HoldingsSort['key'] | undefined;
  dir?: HoldingsSort['dir'] | undefined;
};

export type PortfolioPageProps = {
  search: PortfolioSearch;
  onSearchChange: (patch: PortfolioSearch) => void;
};

/** The summary and the table read the same live rows, so the totals are always their sums. */
function LiveHoldings({
  holdings,
  sort,
  onSortChange,
}: {
  holdings: readonly Holding[];
  sort: HoldingsSort;
  onSortChange: (sort: HoldingsSort) => void;
}) {
  const live = useLiveHoldings(holdings);
  return (
    <>
      <PortfolioSummaryCard totals={live.totals} />
      <div className="rounded-lg border border-line bg-surface">
        <HoldingsTable rows={live.rows} sort={sort} onSortChange={onSortChange} />
      </div>
    </>
  );
}

/**
 * Portfolio (T-151 to T-153): the live summary (invested, current value, total and day's P&L) over
 * a sortable holdings table, both revalued on every tick, or an empty state that points to search.
 */
export function PortfolioPage({ search, onSearchChange }: PortfolioPageProps) {
  const api = useApiClient();
  const holdings = useQuery(holdingsQuery(api));
  const sort: HoldingsSort = {
    key: search.key ?? DEFAULT_HOLDINGS_SORT.key,
    dir: search.dir ?? DEFAULT_HOLDINGS_SORT.dir,
  };

  let body;
  if (holdings.isPending) {
    body = (
      <div className="rounded-lg border border-line bg-surface px-4">
        <SkeletonRows count={4} label={strings.loading} />
      </div>
    );
  } else if (holdings.isError) {
    body = (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState
          title={strings.loadError.title}
          description={strings.loadError.body}
          retryLabel={strings.loadError.retry}
          onRetry={() => void holdings.refetch()}
        />
      </div>
    );
  } else if (holdings.data.items.length === 0) {
    body = (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState
          title={strings.empty.title}
          description={strings.empty.body}
          icon={<IconBriefcase size={24} />}
          action={<SearchStocksButton label={strings.empty.cta} />}
        />
      </div>
    );
  } else {
    body = (
      <LiveHoldings
        holdings={holdings.data.items}
        sort={sort}
        onSortChange={(next) => onSearchChange(next)}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader title={strings.title} description={strings.description} />
      {body}
    </div>
  );
}
