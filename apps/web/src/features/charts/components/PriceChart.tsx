import type { Candle } from '@nthstock/contracts';
import { Skeleton, cn } from '@nthstock/ui';
import { formatIstDate } from '@nthstock/utils';
import { lazy, Suspense } from 'react';
import { seriesDirection } from '../model/chartData';
import { formatChartValue, type ChartDirection, type ChartValueFormat } from '../model/chartFormat';
import { strings } from '../strings';

// The charts library loads on first use, in its own chunk (checked by scripts/checkBuild.mjs).
const PriceChartCanvas = lazy(() =>
  import('./PriceChartCanvas').then((module) => ({ default: module.PriceChartCanvas })),
);

export type PriceChartProps = {
  candles: readonly Candle[];
  /** Accessible name, e.g. "NIFTY 50 area chart over 1 year". */
  label: string;
  type?: 'area' | 'candle';
  /** `inr` for prices in paise, `index` for levels in hundredths of a point. */
  format?: ChartValueFormat;
  /** Colour of an area series; defaults to the move across the candles. */
  direction?: ChartDirection;
  /** Show times on the axis (1D and 1W). */
  intraday?: boolean;
  /** Height in px; the width follows the container. */
  height?: number;
  className?: string;
};

/**
 * TradingView Lightweight Charts, lazy-loaded (T-094). The canvas is decorative to assistive
 * technology: the figure carries the name and a text summary of the range instead.
 */
export function PriceChart({
  candles,
  label,
  type = 'area',
  format = 'inr',
  direction,
  intraday = false,
  height = 240,
  className,
}: PriceChartProps) {
  const first = candles[0];
  const last = candles[candles.length - 1];
  return (
    <figure aria-label={label} className={cn('relative m-0 w-full', className)} style={{ height }}>
      {first && last ? (
        <>
          <Suspense
            fallback={
              <div role="status" aria-label={strings.loadingChart} className="h-full">
                <Skeleton className="h-full w-full" />
              </div>
            }
          >
            <PriceChartCanvas
              candles={candles}
              type={type}
              format={format}
              direction={direction ?? seriesDirection(candles)}
              intraday={intraday}
              height={height}
            />
          </Suspense>
          <figcaption className="sr-only">
            {strings.chartSummary(
              formatChartValue(first.o, format),
              formatChartValue(last.c, format),
              formatIstDate(new Date(first.t)),
              formatIstDate(new Date(last.t)),
            )}
          </figcaption>
        </>
      ) : (
        <figcaption className="grid h-full place-items-center text-body text-ink-muted">
          {strings.noData}
        </figcaption>
      )}
    </figure>
  );
}
