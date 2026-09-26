import type { Instrument, InstrumentStats, Quote } from '@nthstock/contracts';
import { ErrorState, Skeleton } from '@nthstock/ui';
import { formatInr, formatInrCompact, formatIstDate, formatIstTime } from '@nthstock/utils';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Card } from '@/shared/components/Card';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { statsQuery } from '../api/stockDetailQueries';
import { formatCount, formatX100, formatYield } from '../model/statFormat';
import { strings } from '../strings';
import { RangeBar } from './RangeBar';

export type KeyStatsCardProps = {
  instrument: Instrument;
  /** REST quote snapshot: the range markers' last price until a live quote arrives. */
  snapshot?: Quote | null | undefined;
};

/** A value that may be missing (market cap, P/E and yield are null when not meaningful). */
function Optional({ value }: { value: string | null }) {
  if (value !== null) return value;
  return (
    <>
      <span aria-hidden="true">{strings.stats.notAvailable}</span>
      <span className="sr-only">{strings.stats.notAvailableLabel}</span>
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className="m-0 font-mono text-body text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function StatsBody({
  stats,
  instrument,
  snapshot,
}: { stats: InstrumentStats } & KeyStatsCardProps) {
  const { symbol, exchange } = instrument;
  const last = snapshot?.ltp ?? stats.prevClose;
  const asOf = new Date(stats.asOf);
  return (
    <div className="grid gap-5">
      <RangeBar
        name={strings.stats.dayRange}
        symbol={symbol}
        exchange={exchange}
        low={stats.low}
        high={stats.high}
        fallback={last}
      />
      <RangeBar
        name={strings.stats.week52Range}
        symbol={symbol}
        exchange={exchange}
        low={stats.week52Low}
        high={stats.week52High}
        fallback={last}
      />
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label={strings.stats.open}>{formatInr(stats.open)}</Stat>
        <Stat label={strings.stats.prevClose}>{formatInr(stats.prevClose)}</Stat>
        <Stat label={strings.stats.volume}>{formatCount(stats.volume)}</Stat>
        <Stat label={strings.stats.marketCap}>
          <Optional value={stats.marketCap === null ? null : formatInrCompact(stats.marketCap)} />
        </Stat>
        <Stat label={strings.stats.pe}>
          <Optional value={stats.peX100 === null ? null : formatX100(stats.peX100)} />
        </Stat>
        <Stat label={strings.stats.dividendYield}>
          <Optional
            value={stats.dividendYieldBp === null ? null : formatYield(stats.dividendYieldBp)}
          />
        </Stat>
      </dl>
      <p className="text-label text-ink-muted">
        {strings.stats.asOf(formatIstDate(asOf), formatIstTime(asOf))}
      </p>
    </div>
  );
}

/**
 * Key stats and fundamentals (T-109), all from InstrumentStats: day and 52-week ranges with a
 * marker at the live price, open, previous close, volume, market cap in lakh/crore
 * (formatInrCompact), P/E and dividend yield. Equities only.
 */
export function KeyStatsCard({ instrument, snapshot }: KeyStatsCardProps) {
  const api = useApiClient();
  const stats = useQuery(
    statsQuery(api, { symbol: instrument.symbol, exchange: instrument.exchange }),
  );
  return (
    <Card title={strings.stats.title}>
      {stats.data ? (
        <StatsBody stats={stats.data} instrument={instrument} snapshot={snapshot} />
      ) : stats.isError ? (
        <ErrorState
          title={strings.stats.errorTitle}
          description={strings.stats.errorBody}
          retryLabel={strings.stats.retry}
          onRetry={() => void stats.refetch()}
        />
      ) : (
        <div role="status" aria-label={strings.stats.loading} className="grid gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </Card>
  );
}
