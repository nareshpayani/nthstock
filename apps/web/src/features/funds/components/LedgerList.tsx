import type { LedgerEntry } from '@nthstock/contracts';
import {
  Button,
  ErrorState,
  Spinner,
  VirtualCell,
  VirtualHeaderCell,
  VirtualList,
  cn,
} from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { SkeletonRows } from '@/shared/components/SkeletonRows';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { fundsLedgerQuery } from '../api/fundsQuery';
import { ledgerTimeLabel, signedAmount } from '../model/ledgerFormat';
import { strings } from '../strings';

const ROW_HEIGHT = 48;
const COLUMNS = 'minmax(200px,1.3fr) minmax(112px,0.8fr) minmax(180px,2fr) 168px 168px';
/** At most this tall; a short ledger is only as tall as its rows. */
const MAX_HEIGHT = 560;
const HEADERS = [
  { key: 'time', numeric: false },
  { key: 'type', numeric: false },
  { key: 'details', numeric: false },
  { key: 'amount', numeric: true },
  { key: 'balanceAfter', numeric: true },
] as const;

function Amount({ paise }: { paise: number }) {
  const { text, spoken } = signedAmount(paise);
  return (
    <span className={cn(paise > 0 ? 'text-up' : paise < 0 ? 'text-down' : 'text-ink-muted')}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/**
 * The funds ledger (T-159): every entry newest first with its IST time, type, signed amount and
 * the available cash after it, in a virtualised grid (TanStack Virtual). Pages load by cursor as
 * the list scrolls (or ↓/End moves) to its end.
 */
export function LedgerList() {
  const api = useApiClient();
  const ledger = useInfiniteQuery(fundsLedgerQuery(api));
  const entries = useMemo<LedgerEntry[]>(
    () => ledger.data?.pages.flatMap((page) => page.items) ?? [],
    [ledger.data],
  );

  if (ledger.isPending) {
    return (
      <div className="px-4">
        <SkeletonRows count={5} label={strings.ledger.loading} />
      </div>
    );
  }
  if (ledger.isError) {
    return (
      <ErrorState
        title={strings.ledger.loadError}
        retryLabel={strings.ledger.retry}
        onRetry={() => void ledger.refetch()}
      />
    );
  }
  if (entries.length === 0) {
    return <p className="p-4 text-body text-ink-muted">{strings.ledger.empty}</p>;
  }

  const loadMore = () => {
    if (ledger.hasNextPage && !ledger.isFetchingNextPage) void ledger.fetchNextPage();
  };

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto">
        <VirtualList
          items={entries}
          label={strings.ledger.label}
          rowHeight={ROW_HEIGHT}
          height={`min(60dvh, ${String(Math.min(MAX_HEIGHT, (entries.length + 1) * ROW_HEIGHT + 2))}px)`}
          columns={COLUMNS}
          className="min-w-[880px]"
          getKey={(entry) => entry.id}
          onEndReached={loadMore}
          header={HEADERS.map((column) => (
            <VirtualHeaderCell key={column.key} numeric={column.numeric}>
              {strings.ledger.columns[column.key]}
            </VirtualHeaderCell>
          ))}
          renderRow={(entry) => (
            <>
              <VirtualCell className="font-mono text-label tabular-nums">
                <time dateTime={entry.createdAt}>{ledgerTimeLabel(entry.createdAt)}</time>
              </VirtualCell>
              <VirtualCell className="font-semibold">
                {strings.ledger.types[entry.type]}
              </VirtualCell>
              <VirtualCell className="text-label text-ink-muted" title={entry.description}>
                {entry.description}
              </VirtualCell>
              <VirtualCell numeric>
                <Amount paise={entry.amount} />
              </VirtualCell>
              <VirtualCell numeric>{formatInr(entry.balanceAfter)}</VirtualCell>
            </>
          )}
        />
      </div>
      <div className="flex min-h-8 items-center justify-center text-label text-ink-muted">
        {ledger.isFetchingNextPage ? (
          <span role="status" className="inline-flex items-center gap-2">
            <Spinner />
            {strings.ledger.loadingMore}
          </span>
        ) : ledger.isFetchNextPageError ? (
          <Button size="sm" variant="secondary" onClick={loadMore}>
            {strings.ledger.retry}
          </Button>
        ) : ledger.hasNextPage ? null : (
          <span>{strings.ledger.end}</span>
        )}
      </div>
    </div>
  );
}
