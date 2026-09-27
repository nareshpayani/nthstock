import { EmptyState, ErrorState, IconChart } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchStocksButton } from '@/shared/components/SearchStocksButton';
import { SkeletonRows } from '@/shared/components/SkeletonRows';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { positionsQuery } from '../api/positionsQuery';
import { strings } from '../strings';
import { PositionsTable } from './PositionsTable';
import { PositionsTotalBar } from './PositionsTotalBar';

/**
 * Positions (T-149, T-150, T-153): today's paper positions with live LTP and P&L, a pinned total
 * P&L bar, Exit into the order ticket, and an empty state that points to search. Order updates
 * refetch the list (T-147); ticks move only the price and P&L cells.
 */
export function PositionsPage() {
  const api = useApiClient();
  const positions = useQuery(positionsQuery(api));

  let body;
  if (positions.isPending) {
    body = (
      <div className="px-4">
        <SkeletonRows count={4} label={strings.loading} />
      </div>
    );
  } else if (positions.isError) {
    body = (
      <ErrorState
        title={strings.loadError.title}
        description={strings.loadError.body}
        retryLabel={strings.loadError.retry}
        onRetry={() => void positions.refetch()}
      />
    );
  } else if (positions.data.items.length === 0) {
    body = (
      <EmptyState
        title={strings.empty.title}
        description={strings.empty.body}
        icon={<IconChart size={24} />}
        action={<SearchStocksButton label={strings.empty.cta} />}
      />
    );
  } else {
    body = <PositionsTable positions={positions.data.items} />;
  }

  const items = positions.data?.items ?? [];
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader title={strings.title} description={strings.description} />
      <div className="rounded-lg border border-line bg-surface">{body}</div>
      {items.length > 0 ? <PositionsTotalBar positions={items} /> : null}
    </div>
  );
}
