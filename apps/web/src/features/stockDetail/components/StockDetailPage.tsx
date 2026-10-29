import type { Instrument } from '@nthstock/contracts';
import { TouchTargets, cn } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { keepInterval } from '@/features/charts';
import { SectionBoundary } from '@/shared/components/SectionBoundary';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { usePhoneLayout, useTouchScreen } from '@/shared/hooks/usePhoneLayout';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { quoteSnapshotQuery } from '../api/stockDetailQueries';
import { DEFAULT_STOCK_RANGE, type StockDetailSearch } from '../model/stockDetailSearch';
import { rememberChartType, rememberedChartType } from '../model/chartTypePreference';
import { strings } from '../strings';
import { IndexEtfTrade } from './IndexEtfTrade';
import { KeyStatsCard } from './KeyStatsCard';
import { MarketDepthCard } from './MarketDepthCard';
import { OverviewCard } from './OverviewCard';
import { PhoneStockDetail } from './PhoneStockDetail';
import { StockChartCard } from './StockChartCard';
import { SimulatorPanel } from './SimulatorPanel';
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

const section = (label: string, children: ReactNode) => <Section label={label}>{children}</Section>;

/**
 * Stock detail (E5): header, chart, market depth, key stats and overview for one instrument on
 * one exchange. Indices show the header and chart, and trade through their tracking ETF
 * (NSTOCK-0440, `IndexEtfTrade`: a card under the header, or on a phone a bar at the bottom). On a
 * phone every instrument, index or equity, gets the phone layout (T12 and NSTOCK-0447,
 * `PhoneStockDetail`); from 768 px the page is unchanged.
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
  const phone = usePhoneLayout();
  const touchScreen = useTouchScreen();

  if (phone) {
    return (
      <PhoneStockDetail
        instrument={instrument}
        snapshot={snapshot.data}
        snapshotFailed={snapshot.isError}
        onRetrySnapshot={() => void snapshot.refetch()}
        search={search}
        onSearchChange={onSearchChange}
        section={section}
      />
    );
  }

  return (
    // On a tablet the page keeps this layout, with touch-size controls (SPEC-CR-1 §6.3).
    <TouchTargets enabled={touchScreen}>
      <div className="mx-auto grid w-full max-w-[1200px] animate-content-in grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
        <StockHeader
          instrument={instrument}
          snapshot={snapshot.data}
          snapshotFailed={snapshot.isError}
          onRetry={() => void snapshot.refetch()}
          onExchangeChange={(exchange) => onSearchChange({ exchange })}
        />
        {equity ? null : <IndexEtfTrade index={instrument} />}
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
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {equity ? <SimulatorPanel symbol={instrument.symbol} /> : null}
              <StockChartCard
                instrument={instrument}
                range={search.range ?? DEFAULT_STOCK_RANGE}
                chartType={search.chart ?? rememberedChartType()}
                interval={search.interval}
                onRangeChange={(range) =>
                  onSearchChange({ range, interval: keepInterval(range, search.interval) })
                }
                onIntervalChange={(interval) => onSearchChange({ interval })}
                onChartTypeChange={(chart) => {
                  rememberChartType(chart);
                  onSearchChange({ chart });
                }}
                trading={equity}
              />
            </div>
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
    </TouchTargets>
  );
}
