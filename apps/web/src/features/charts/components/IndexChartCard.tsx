import {
  CANDLE_INTERVALS,
  type Candle,
  type CandleInterval,
  type CandleRange,
} from '@nthstock/contracts';
import {
  ErrorState,
  IconButton,
  IconChevronRight,
  IconMinus,
  IconPlus,
  IconRefresh,
  SegmentedControl,
  Skeleton,
} from '@nthstock/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type PointerEvent } from 'react';
import { Card } from '@/shared/components/Card';
import { LiveChange } from '@/shared/components/LiveChange';
import { PriceCell } from '@/shared/components/PriceCell';
import { useMarketOpen } from '@/shared/hooks/useMarketOpen';
import { useDayDirection } from '@/shared/hooks/useQuote';
import { usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { candlesQuery } from '../api/candlesQuery';
import { useLiveCandles } from '../hooks/useLiveCandles';
import { DEFAULT_INDEX_CHART_TYPE, chartTypeName, type PriceChartType } from '../model/chartTypes';
import {
  CHART_RANGES,
  NIFTY,
  intervalLabel,
  isIntraday,
  rangeLabel,
  resolveInterval,
} from '../model/ranges';
import { strings } from '../strings';
import { useChartStudies } from '../model/studiesStore';
import { ChartTypeMenu } from './ChartTypeMenu';
import { IndicatorsMenu } from './IndicatorsMenu';
import { LiveBadge } from './LiveBadge';
import { PriceChart } from './PriceChart';
import type { ChartHandle } from './PriceChartCanvas';
import { zoomedLogicalRange } from '../model/chartZoom';

export type IndexChartCardProps = {
  range: CandleRange;
  /** Bar size from the URL (NSTOCK-0443); the range's own when absent or not offered. */
  interval?: CandleInterval | undefined;
  /** Line by default (NSTOCK-0443). */
  chartType?: PriceChartType;
  onRangeChange: (range: CandleRange) => void;
  onIntervalChange?: (interval: CandleInterval) => void;
  onChartTypeChange?: (type: PriceChartType) => void;
};

const CHART_HEIGHT = 260;
/** A press that moves less than this, in px, is a tap that opens the chart page, not a pan. */
const TAP_SLOP = 6;
/** A press held longer than this, in ms, is a look at the crosshair, not a tap. */
const TAP_MAX_MS = 300;

const NO_CANDLES: readonly Candle[] = [];
/** When a press started or ended; read in pointer handlers only, never while rendering. */
const pressTime = () => performance.now();

/**
 * NIFTY 50 chart card (T-095): the live level and day change, a chart of the chosen range
 * and a LIVE badge while NSE is open. The range lives in the URL (the dashboard owns it).
 * NSTOCK-0437: the chart pans (drag), zooms (wheel, pinch, or the − + buttons) and shows the
 * crosshair; a tap on it, or the title, opens the full NIFTY 50 page on the same range.
 * NSTOCK-0443: it has the instrument page's chart type menu and bar size picker, opens as a line
 * of 1-minute bars on 1D, and the tap carries the type and bar size to the NIFTY 50 page too.
 */
export function IndexChartCard({
  range,
  interval: requestedInterval,
  chartType = DEFAULT_INDEX_CHART_TYPE,
  onRangeChange,
  onIntervalChange,
  onChartTypeChange,
}: IndexChartCardProps) {
  const api = useApiClient();
  const navigate = useNavigate();
  const [chart, setChart] = useState<ChartHandle | null>(null);
  const pressRef = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  // Fingers down on the plot: a second one makes it a pinch, never a tap.
  const pointersRef = useRef(new Set<number>());
  const phone = usePhoneLayout();
  const studies = useChartStudies((state) => state.studies);
  const interval = resolveInterval(range, requestedInterval);
  const intervals = CANDLE_INTERVALS[range];
  // The NIFTY 50 page opens on what this card shows.
  const pageSearch = {
    exchange: NIFTY.exchange,
    range,
    chart: chartType,
    ...(interval === intervals[0] ? {} : { interval }),
  };
  const openChart = () =>
    navigate({
      to: '/stocks/$symbol',
      params: { symbol: NIFTY.symbol },
      search: pageSearch,
    }).catch((error: unknown) => {
      console.error('Opening the NIFTY 50 page failed', error);
    });
  // On the price axis a press is the chart's own (it scales prices), never a tap.
  const onPriceAxis = (event: PointerEvent<HTMLDivElement>) => {
    const axis = chart?.chart.priceScale('right').width() ?? 0;
    return event.clientX >= event.currentTarget.getBoundingClientRect().right - axis;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A primary pointer is the first one down, so any id still held is stale (a press that ended
    // off the plot).
    if (event.isPrimary) pointersRef.current.clear();
    pointersRef.current.add(event.pointerId);
    pressRef.current =
      event.button === 0 && pointersRef.current.size === 1 && !onPriceAxis(event)
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: pressTime() }
        : null;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (moved <= TAP_SLOP && pressTime() - press.at <= TAP_MAX_MS) void openChart();
  };
  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    pressRef.current = null;
  };
  const zoom = (steps: number) => {
    const timeScale = chart?.chart.timeScale();
    const visible = timeScale?.getVisibleLogicalRange();
    if (!timeScale || !visible) return;
    timeScale.setVisibleLogicalRange(zoomedLogicalRange(visible, steps));
  };
  const marketOpen = useMarketOpen();
  const candles = useQuery({
    ...candlesQuery(api, { ...NIFTY, range, interval }),
    // Keep the old range on screen while the new one loads, so the card does not jump.
    placeholderData: keepPreviousData,
  });
  // NSTOCK-0441: the last bar follows the live level and a new bar starts on time.
  const bars = useLiveCandles(
    NIFTY.symbol,
    NIFTY.exchange,
    candles.data?.candles ?? NO_CANDLES,
    marketOpen && candles.data?.interval === interval && !candles.isPlaceholderData,
    interval,
  );
  // NSTOCK-0446: on 1D the line's colour is the day's change, the same as the change badge. The
  // series alone can't say it: in the first hour it leads with the previous session.
  const today = useDayDirection(NIFTY.symbol, NIFTY.exchange);
  const direction = range === '1D' ? today : undefined;
  const showIntervals = intervals.length > 1 && onIntervalChange !== undefined;

  return (
    <Card
      // The LIVE badge sits beside the heading, not in it, so the section is named "NIFTY 50".
      // The title is the keyboard path to the NIFTY 50 page; the plot's tap is for pointers.
      title={
        <Link
          to="/stocks/$symbol"
          params={{ symbol: NIFTY.symbol }}
          search={pageSearch}
          className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
        >
          {strings.niftyTitle}
          <IconChevronRight aria-hidden="true" className="size-4" />
        </Link>
      }
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {marketOpen ? <LiveBadge /> : null}
          <SegmentedControl
            label={strings.rangeLabel}
            size="sm"
            value={range}
            onValueChange={onRangeChange}
            options={CHART_RANGES.map((value) => ({ value, label: value }))}
          />
          {showIntervals ? (
            phone ? (
              // Five more segments would wrap on a phone, so the bar size is a native select there,
              // 44 px tall like the chart type button beside it.
              <select
                aria-label={strings.intervalLabel}
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
            ) : (
              <SegmentedControl
                label={strings.intervalLabel}
                size="sm"
                value={interval}
                onValueChange={onIntervalChange}
                options={intervals.map((value) => ({
                  value,
                  label: value,
                  ariaLabel: strings.intervalOption(intervalLabel(value)),
                }))}
              />
            )
          ) : null}
          {onChartTypeChange ? (
            <ChartTypeMenu value={chartType} onValueChange={onChartTypeChange} touch={phone} />
          ) : null}
          <IndicatorsMenu touch={phone} />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <PriceCell symbol={NIFTY.symbol} exchange={NIFTY.exchange} format="index" size="lg" />
        <LiveChange symbol={NIFTY.symbol} exchange={NIFTY.exchange} format="index" soft size="md" />
      </div>
      <div aria-busy={candles.isFetching} className="relative">
        {chart && candles.data ? (
          <div
            role="group"
            aria-label={strings.zoom.label}
            className="absolute top-1 right-16 z-10 flex gap-1 rounded-md border border-line bg-surface/90 p-0.5"
          >
            <IconButton
              size="sm"
              label={strings.zoom.out}
              icon={<IconMinus aria-hidden="true" className="size-4" />}
              onClick={() => zoom(-1)}
            />
            <IconButton
              size="sm"
              label={strings.zoom.in}
              icon={<IconPlus aria-hidden="true" className="size-4" />}
              onClick={() => zoom(1)}
            />
            <IconButton
              size="sm"
              label={strings.zoom.reset}
              icon={<IconRefresh aria-hidden="true" className="size-4" />}
              onClick={() => chart.chart.timeScale().fitContent()}
            />
          </div>
        ) : null}
        {candles.isError && !candles.data ? (
          <div style={{ height: CHART_HEIGHT }} className="grid place-items-center">
            <ErrorState
              title={strings.errorTitle}
              description={strings.errorBody}
              retryLabel={strings.retry}
              onRetry={() => void candles.refetch()}
            />
          </div>
        ) : candles.data ? (
          // A tap opens the full chart; a drag pans and is left to the chart.
          <div
            data-testid="dashboard-chart"
            className="cursor-pointer"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            <PriceChart
              candles={bars}
              direction={direction}
              label={strings.niftyChartLabel(
                chartTypeName(chartType),
                rangeLabel(range),
                interval === intervals[0] ? undefined : intervalLabel(interval),
              )}
              type={chartType}
              format="index"
              intraday={isIntraday(range)}
              height={CHART_HEIGHT}
              legend
              studies={studies}
              interactive
              onReady={setChart}
              className={candles.isPlaceholderData ? 'opacity-60' : undefined}
            />
          </div>
        ) : (
          <div role="status" aria-label={strings.loadingChart} style={{ height: CHART_HEIGHT }}>
            <Skeleton className="h-full w-full" />
          </div>
        )}
      </div>
    </Card>
  );
}
