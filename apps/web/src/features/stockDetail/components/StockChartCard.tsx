import {
  CANDLE_INTERVALS,
  INTRADAY_INTERVAL_MINUTES,
  type Candle,
  type CandleInterval,
  type CandleRange,
  type Instrument,
} from '@nthstock/contracts';
import { ErrorState, SegmentedControl, Skeleton } from '@nthstock/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChartTrading } from '@/features/chartTrading';
import { AlertLines } from '@/features/notifications';
import {
  CHART_RANGES,
  type ChartHandle,
  LiveBadge,
  PriceChart,
  candlesQuery,
  intervalLabel,
  isIntraday,
  rangeLabel,
  resolveInterval,
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
  /** Bar size from the URL (NSTOCK-0343); the range's own when absent or not offered. */
  interval?: CandleInterval | undefined;
  chartType: ChartType;
  onRangeChange: (range: CandleRange) => void;
  onIntervalChange?: (interval: CandleInterval) => void;
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
 * Stock price chart (T-107): 1D to 5Y range tabs, a bar size picker (1, 5, 15, 30 or 60-minute
 * bars on 1D; NSTOCK-0343) and an area/candle toggle, all kept in the URL by the page, and a crosshair tooltip with the hovered bar's IST time and ₹ values. The previous
 * range stays on screen, dimmed, while the next one loads. On 1D while the market is open, the
 * last bar moves with every live quote and a new bar starts each minute (T-108).
 */
export function StockChartCard({
  instrument,
  range,
  interval: requestedInterval,
  chartType,
  onRangeChange,
  onIntervalChange,
  onChartTypeChange,
  height = CHART_HEIGHT,
  controls = 'sm',
  trading = false,
}: StockChartCardProps) {
  const [chart, setChart] = useState<ChartHandle | null>(null);
  const api = useApiClient();
  const marketOpen = useMarketOpen();
  const { symbol, exchange } = instrument;
  const interval = resolveInterval(range, requestedInterval);
  const intervals = CANDLE_INTERVALS[range];
  const candles = useQuery({
    ...candlesQuery(api, { symbol, exchange, range, interval }),
    placeholderData: keepPreviousData,
  });
  const format = instrument.type === 'INDEX' ? 'index' : 'inr';
  // T-108: while NSE is open, today's bars follow the quote store, whatever their size.
  const barMinutes = INTRADAY_INTERVAL_MINUTES[interval];
  const live =
    marketOpen &&
    range === '1D' &&
    barMinutes !== null &&
    candles.data?.interval === interval &&
    !candles.isPlaceholderData;
  const bars = useLiveCandles(
    symbol,
    exchange,
    candles.data?.candles ?? NO_CANDLES,
    live,
    barMinutes ?? 1,
  );

  return (
    <Card
      // The LIVE badge sits beside the heading, not in it, so the section is named "Price chart".
      title={strings.chart.title}
      aside={
        // The controls wrap onto a second row on a narrow phone rather than scroll sideways, so
        // "Candles" is never cut off at the card's edge. There the LIVE badge goes last, beside
        // the chart type, so two rows hold everything down to 340 px.
        <div className="flex flex-wrap items-center gap-2">
          {marketOpen && range === '1D' ? (
            <span className={controls === 'touch' ? 'order-last' : undefined}>
              <LiveBadge />
            </span>
          ) : null}
          <SegmentedControl
            label={strings.chart.rangeLabel}
            size={controls}
            value={range}
            onValueChange={onRangeChange}
            options={CHART_RANGES.map((value) => ({ value, label: value }))}
          />
          {intervals.length > 1 && onIntervalChange && controls !== 'touch' ? (
            <SegmentedControl
              label={strings.chart.intervalLabel}
              size={controls}
              value={interval}
              onValueChange={onIntervalChange}
              options={intervals.map((value) => ({
                value,
                label: value,
                ariaLabel: strings.chart.intervalOption(intervalLabel(value)),
              }))}
            />
          ) : null}
          <SegmentedControl
            label={strings.chart.typeLabel}
            size={controls}
            value={chartType}
            onValueChange={onChartTypeChange}
            options={CHART_TYPES.map((value) => ({ value, label: strings.chart.types[value] }))}
          />
          {intervals.length > 1 && onIntervalChange && controls === 'touch' ? (
            // On a phone five more segments would push the chart under the trade bar, so the bar
            // size is a native select beside the chart type: one row, and the OS picker.
            <select
              aria-label={strings.chart.intervalLabel}
              value={interval}
              onChange={(event) => {
                const next = intervals.find((value) => value === event.target.value);
                if (next) onIntervalChange(next);
              }}
              className="h-11 rounded-md border border-line bg-canvas px-3 text-body font-medium text-ink focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none"
            >
              {intervals.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}
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
              interval === intervals[0] ? undefined : intervalLabel(interval),
            )}
            type={chartType}
            format={format}
            intraday={isIntraday(range)}
            height={height}
            tooltip
            interactive={trading}
            onReady={trading ? setChart : undefined}
            overlay={
              trading && chart ? (
                <>
                  <ChartTrading handle={chart} instrument={instrument} />
                  <AlertLines handle={chart} symbol={symbol} exchange={exchange} />
                </>
              ) : null
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
