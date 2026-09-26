import type { CandleRange } from '@nthstock/contracts';
import { ErrorState, SegmentedControl, Skeleton } from '@nthstock/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

export type IndexChartCardProps = {
  range: CandleRange;
  onRangeChange: (range: CandleRange) => void;
};

const CHART_HEIGHT = 260;

/**
 * NIFTY 50 chart card (T-095): the live level and day change, an area chart of the chosen range
 * and a LIVE badge while NSE is open. The range lives in the URL (the dashboard owns it).
 */
export function IndexChartCard({ range, onRangeChange }: IndexChartCardProps) {
  const api = useApiClient();
  const marketOpen = useMarketOpen();
  const candles = useQuery({
    ...candlesQuery(api, { ...NIFTY, range }),
    // Keep the old range on screen while the new one loads, so the card does not jump.
    placeholderData: keepPreviousData,
  });

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-3">
          {strings.niftyTitle}
          {marketOpen ? <LiveBadge /> : null}
        </span>
      }
      aside={
        <SegmentedControl
          label={strings.rangeLabel}
          size="sm"
          value={range}
          onValueChange={onRangeChange}
          options={CHART_RANGES.map((value) => ({ value, label: value }))}
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <PriceCell symbol={NIFTY.symbol} exchange={NIFTY.exchange} format="index" size="lg" />
        <LiveChange symbol={NIFTY.symbol} exchange={NIFTY.exchange} format="index" soft size="md" />
      </div>
      <div aria-busy={candles.isFetching} className="relative">
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
          <PriceChart
            candles={candles.data.candles}
            label={strings.niftyChartLabel(strings.ranges[range])}
            format="index"
            intraday={isIntraday(range)}
            height={CHART_HEIGHT}
            className={candles.isPlaceholderData ? 'opacity-60' : undefined}
          />
        ) : (
          <div role="status" aria-label={strings.loadingChart} style={{ height: CHART_HEIGHT }}>
            <Skeleton className="h-full w-full" />
          </div>
        )}
      </div>
    </Card>
  );
}
