import type { Instrument } from '@nthstock/contracts';
import { cn } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SectionBoundary } from '@/shared/components/SectionBoundary';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { quoteSnapshotQuery } from '../api/stockDetailQueries';
import {
  DEFAULT_CHART_TYPE,
  DEFAULT_STOCK_RANGE,
  type StockDetailSearch,
} from '../model/stockDetailSearch';
import { strings } from '../strings';
import { KeyStatsCard } from './KeyStatsCard';
import { MarketDepthCard } from './MarketDepthCard';
import { OverviewCard } from './OverviewCard';
import { StockChartCard } from './StockChartCard';
import { StockHeader } from './StockHeader';

export type StockDetailPageProps = {
  instrument: Instrument;
  /** URL state: chart range, exchange and chart type. */
  search?: StockDetailSearch;
  onSearchChange?: (patch: StockDetailSearch) => void;
};

const ignore = () => undefined;

/** One section behind its own error boundary: a crash stays inside it. */
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
 * Stock detail (E5): header, chart, market depth, key stats and overview for one instrument on
 * one exchange. Indices show the header and chart only.
 */
export function StockDetailPage({
  instrument,
  search = {},
  onSearchChange = ignore,
}: StockDetailPageProps) {
  useDocumentTitle(strings.pageTitle(instrument.name, instrument.symbol));
  const api = useApiClient();
  const listing = { symbol: instrument.symbol, exchange: instrument.exchange };
  const snapshot = useQuery(quoteSnapshotQuery(api, listing));
  const equity = instrument.type === 'EQUITY';

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <StockHeader
        instrument={instrument}
        snapshot={snapshot.data}
        onExchangeChange={(exchange) => onSearchChange({ exchange })}
      />
      {/*
        T-112: one column under 1024 px, in reading order chart, depth, stats, overview. From
        1024 px (lg) chart, stats and overview fill the left column and depth sits at the top of
        a narrower right column, spanning the left column's rows.
      */}
      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6',
          equity && 'lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] lg:items-start',
        )}
      >
        <Section label={strings.chart.title}>
          <StockChartCard
            instrument={instrument}
            range={search.range ?? DEFAULT_STOCK_RANGE}
            chartType={search.chart ?? DEFAULT_CHART_TYPE}
            onRangeChange={(range) => onSearchChange({ range })}
            onChartTypeChange={(chart) => onSearchChange({ chart })}
          />
        </Section>
        {equity ? (
          <>
            <div className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1">
              <Section label={strings.depth.title}>
                <MarketDepthCard instrument={instrument} />
              </Section>
            </div>
            <div className="min-w-0 lg:col-start-1">
              <Section label={strings.stats.title}>
                <KeyStatsCard instrument={instrument} snapshot={snapshot.data} />
              </Section>
            </div>
            <div className="min-w-0 lg:col-start-1">
              <Section label={strings.overview.title}>
                <OverviewCard instrument={instrument} />
              </Section>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
