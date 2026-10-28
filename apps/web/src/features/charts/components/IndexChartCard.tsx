import type { CandleRange } from '@nthstock/contracts';
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
import { useApiClient } from '@/shared/lib/apiClientContext';
import { candlesQuery } from '../api/candlesQuery';
import { CHART_RANGES, NIFTY, isIntraday } from '../model/ranges';
import { strings } from '../strings';
import { LiveBadge } from './LiveBadge';
import { PriceChart } from './PriceChart';
import type { ChartHandle } from './PriceChartCanvas';
import { zoomedLogicalRange } from '../model/chartZoom';

export type IndexChartCardProps = {
  range: CandleRange;
  onRangeChange: (range: CandleRange) => void;
};

const CHART_HEIGHT = 260;
/** A press that moves less than this, in px, is a tap that opens the chart page, not a pan. */
const TAP_SLOP = 6;

/**
 * NIFTY 50 chart card (T-095): the live level and day change, an area chart of the chosen range
 * and a LIVE badge while NSE is open. The range lives in the URL (the dashboard owns it).
 * NSTOCK-0437: the chart pans (drag), zooms (wheel, pinch, or the − + buttons) and shows the
 * crosshair; a tap on it, or the title, opens the full NIFTY 50 page on the same range.
 */
export function IndexChartCard({ range, onRangeChange }: IndexChartCardProps) {
  const api = useApiClient();
  const navigate = useNavigate();
  const [chart, setChart] = useState<ChartHandle | null>(null);
  const pressRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const openChart = () =>
    void navigate({
      to: '/stocks/$symbol',
      params: { symbol: NIFTY.symbol },
      search: { exchange: NIFTY.exchange, range },
    });
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pressRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (moved <= TAP_SLOP) openChart();
  };
  const zoom = (steps: number) => {
    const timeScale = chart?.chart.timeScale();
    const visible = timeScale?.getVisibleLogicalRange();
    if (!timeScale || !visible) return;
    timeScale.setVisibleLogicalRange(zoomedLogicalRange(visible, steps));
  };
  const marketOpen = useMarketOpen();
  const candles = useQuery({
    ...candlesQuery(api, { ...NIFTY, range }),
    // Keep the old range on screen while the new one loads, so the card does not jump.
    placeholderData: keepPreviousData,
  });

  return (
    <Card
      // The LIVE badge sits beside the heading, not in it, so the section is named "NIFTY 50".
      title={
        <Link
          to="/stocks/$symbol"
          params={{ symbol: NIFTY.symbol }}
          search={{ exchange: NIFTY.exchange, range }}
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
            className="absolute top-1 left-1 z-10 flex gap-1 rounded-md border border-line bg-surface/90 p-0.5"
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
            onPointerCancel={() => (pressRef.current = null)}
          >
            <PriceChart
              candles={candles.data.candles}
              label={strings.niftyChartLabel(strings.ranges[range])}
              format="index"
              intraday={isIntraday(range)}
              height={CHART_HEIGHT}
              tooltip
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
