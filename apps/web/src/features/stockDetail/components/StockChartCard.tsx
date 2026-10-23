import type { Candle, CandleRange, Instrument } from '@nthstock/contracts';
import { ErrorState, SegmentedControl, Skeleton, cn } from '@nthstock/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChartTrading } from '@/features/chartTrading';
import {
  CHART_RANGES,
  type ChartHandle,
  LiveBadge,
  PriceChart,
  candlesQuery,
  isIntraday,
  rangeLabel,
  useLiveCandles,
} from '@/features/charts';
import { Card } from '@/shared/components/Card';
import { useMarketOpen } from '@/shared/hooks/useMarketOpen';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { CHART_TYPES, type ChartType } from '../model/stockDetailSearch';
import { strings } from '../strings';

export type StockChartCardProps = {
  instrument: Instrument;
  range: CandleRange;
  chartType: ChartType;
  onRangeChange: (range: CandleRange) => void;
  onChartTypeChange: (type: ChartType) => void;
  /** Chart height in px; the phone layout sizes it to the screen (T12). */
  height?: number;
  /** `touch` on phones: 44 px range and type segments in a row that scrolls sideways (T12). */
  controls?: 'sm' | 'touch';
  /** Trade from the chart: pan and pinch, and the trading overlay (T15). Equities only. */
  trading?: boolean;
};

export const CHART_HEIGHT = 320;
const NO_CANDLES: readonly Candle[] = [];

/**
 * Stock price chart (T-107): 1D to 5Y range tabs and an area/candle toggle, both kept in the URL
 * by the page, and a crosshair tooltip with the hovered bar's IST time and ₹ values. The previous
 * range stays on screen, dimmed, while the next one loads. On 1D while the market is open, the
 * last bar moves with every live quote and a new bar starts each minute (T-108).
 */
export function StockChartCard({
  instrument,
  range,
  chartType,
  onRangeChange,
  onChartTypeChange,
  height = CHART_HEIGHT,
  controls = 'sm',
  trading = false,
}: StockChartCardProps) {
  const [chart, setChart] = useState<ChartHandle | null>(null);
  const api = useApiClient();
  const marketOpen = useMarketOpen();
  const { symbol, exchange } = instrument;
  const candles = useQuery({
    ...candlesQuery(api, { symbol, exchange, range }),
    placeholderData: keepPreviousData,
  });
  const format = instrument.type === 'INDEX' ? 'index' : 'inr';
  // T-108: while NSE is open, today's 1-minute bars follow the quote store.
  const live =
    marketOpen && range === '1D' && candles.data?.interval === '1m' && !candles.isPlaceholderData;
  const bars = useLiveCandles(symbol, exchange, candles.data?.candles ?? NO_CANDLES, live);

  return (
    <Card
      // The LIVE badge sits beside the heading, not in it, so the section is named "Price chart".
      title={strings.chart.title}
      aside={
        <div
          className={cn(
            'flex items-center gap-2',
            controls === 'touch' ? '-mx-1 max-w-full overflow-x-auto px-1 pb-1' : 'flex-wrap',
          )}
        >
          {marketOpen && range === '1D' ? <LiveBadge /> : null}
          <SegmentedControl
            label={strings.chart.rangeLabel}
            size={controls}
            value={range}
            onValueChange={onRangeChange}
            options={CHART_RANGES.map((value) => ({ value, label: value }))}
          />
          <SegmentedControl
            label={strings.chart.typeLabel}
            size={controls}
            value={chartType}
            onValueChange={onChartTypeChange}
            options={CHART_TYPES.map((value) => ({ value, label: strings.chart.types[value] }))}
          />
        </div>
      }
    >
      <div aria-busy={candles.isFetching} className="relative">
        {candles.isError && !candles.data ? (
          <div style={{ height }} className="grid place-items-center">
            <ErrorState
              title={strings.chart.errorTitle}
              description={strings.chart.errorBody}
              retryLabel={strings.chart.retry}
              onRetry={() => void candles.refetch()}
            />
          </div>
        ) : candles.data ? (
          <PriceChart
            candles={bars}
            label={strings.chart.label(
              symbol,
              strings.chart.typeNames[chartType],
              rangeLabel(range),
            )}
            type={chartType}
            format={format}
            intraday={isIntraday(range)}
            height={height}
            tooltip
            interactive={trading}
            onReady={trading ? setChart : undefined}
            overlay={
              trading && chart ? <ChartTrading handle={chart} instrument={instrument} /> : null
            }
            className={candles.isPlaceholderData ? 'opacity-60' : undefined}
          />
        ) : (
          <div role="status" aria-label={strings.chart.loading} style={{ height }}>
            <Skeleton className="h-full w-full" />
          </div>
        )}
      </div>
    </Card>
  );
}
