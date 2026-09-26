import type { Instrument } from '@nthstock/contracts';
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

/** Stock detail (E5): header, chart and key stats for one instrument on one exchange. */
export function StockDetailPage({
  instrument,
  search = {},
  onSearchChange = ignore,
}: StockDetailPageProps) {
  useDocumentTitle(strings.pageTitle(instrument.name, instrument.symbol));
  const api = useApiClient();
  const listing = { symbol: instrument.symbol, exchange: instrument.exchange };
  const snapshot = useQuery(quoteSnapshotQuery(api, listing));

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <StockHeader
        instrument={instrument}
        snapshot={snapshot.data}
        onExchangeChange={(exchange) => onSearchChange({ exchange })}
      />
      <Section label={strings.chart.title}>
        <StockChartCard
          instrument={instrument}
          range={search.range ?? DEFAULT_STOCK_RANGE}
          chartType={search.chart ?? DEFAULT_CHART_TYPE}
          onRangeChange={(range) => onSearchChange({ range })}
          onChartTypeChange={(chart) => onSearchChange({ chart })}
        />
      </Section>
    </div>
  );
}
