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
import { useId, useState } from 'react';
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
import { useForcedState, useOffline } from '@/shared/lib/connectivity';
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
  /**
   * `touch` is the phone layout (T12, SPEC-CR-1 §6.1): no card chrome, an edge-to-edge plot, the
   * chart type and bar size above it and 44 px range segments across the full width below it.
   */
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
  const headingId = useId();
  const api = useApiClient();
  const marketOpen = useMarketOpen();
  const { symbol, exchange } = instrument;
  const interval = resolveInterval(range, requestedInterval);
  const intervals = CANDLE_INTERVALS[range];
  const candles = useQuery({
    ...candlesQuery(api, { symbol, exchange, range, interval }),
    placeholderData: keepPreviousData,
  });
  // A state forced from the demo "States" row (SPEC-CR-1 §7) stands in for what the query says.
  const forced = useForcedState();
  const offline = useOffline();
  const failed = forced === 'error' || (candles.isError && !candles.data);
  const loaded = forced === 'loading' ? false : candles.data !== undefined;
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

  const touch = controls === 'touch';
  const liveBadge = marketOpen && range === '1D' && !offline ? <LiveBadge /> : null;
  const rangeControl = (
    <SegmentedControl
      label={strings.chart.rangeLabel}
      size={controls}
      value={range}
      onValueChange={onRangeChange}
      options={CHART_RANGES.map((value) => ({ value, label: value }))}
      {...(touch ? { className: 'w-full' } : {})}
    />
  );
  const typeControl = (
    <SegmentedControl
      label={strings.chart.typeLabel}
      size={controls}
      value={chartType}
      onValueChange={onChartTypeChange}
      options={CHART_TYPES.map((value) => ({ value, label: strings.chart.types[value] }))}
    />
  );
  const showIntervals = intervals.length > 1 && onIntervalChange !== undefined;
  const plot = (
    <div aria-busy={candles.isFetching} className="relative">
      {failed ? (
        <div style={{ height }} className="grid place-items-center">
          <ErrorState
            title={strings.chart.errorTitle}
            description={strings.chart.errorBody}
            retryLabel={strings.chart.retry}
            onRetry={() => void candles.refetch()}
          />
        </div>
      ) : loaded ? (
        <PriceChart
          candles={forced === 'empty' ? NO_CANDLES : bars}
          emptyText={range === '1D' ? strings.chart.emptyToday : undefined}
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
      {offline && loaded && !failed ? (
        <span
          role="status"
          data-testid="chart-paused"
          className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-pill bg-ink px-3 py-1 text-label font-medium whitespace-nowrap text-surface shadow-sm"
        >
          {strings.chart.paused}
        </span>
      ) : null}
    </div>
  );

  if (touch) {
    // The phone instrument page (SPEC-CR-1 §6.1): no card chrome, the plot edge to edge, the chart
    // type and bar size in a slim row above it and the ranges in a full-width row under it, where
    // the thumb is. The heading stays for screen readers, so the section is still "Price chart".
    return (
      <section aria-labelledby={headingId} className="grid gap-2" data-part="phone-chart">
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="sr-only">
            {strings.chart.title}
          </h2>
          {liveBadge}
          <div className="ml-auto flex items-center gap-2">
            {typeControl}
            {showIntervals ? (
              // Five more segments would not fit beside the type, so the bar size is a native
              // select: one row, and the OS picker.
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
        </div>
        <div className="-mx-4">{plot}</div>
        {rangeControl}
      </section>
    );
  }

  return (
    <Card
      // The LIVE badge sits beside the heading, not in it, so the section is named "Price chart".
      title={strings.chart.title}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {liveBadge}
          {rangeControl}
          {showIntervals ? (
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
          {typeControl}
        </div>
      }
    >
      {plot}
    </Card>
  );
}
