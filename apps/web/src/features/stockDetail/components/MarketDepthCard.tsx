import type { Depth, DepthLevel, Instrument } from '@nthstock/contracts';
import { DEPTH_LEVELS } from '@nthstock/contracts';
import { ErrorState, Skeleton, cn } from '@nthstock/ui';
import { formatInr, formatIstTime } from '@nthstock/utils';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Card } from '@/shared/components/Card';
import { useInView } from '@/shared/hooks/useInView';
import { useMarketOpen } from '@/shared/hooks/useMarketOpen';
import { usePageVisible } from '@/shared/hooks/usePageVisible';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { DEPTH_REFRESH_MS, depthQuery } from '../api/stockDetailQueries';
import { barPercent, depthScale } from '../model/depthBars';
import { formatCount } from '../model/statFormat';
import { strings } from '../strings';

export type MarketDepthCardProps = {
  instrument: Instrument;
};

type Side = 'bid' | 'ask';

const SIDE = {
  bid: {
    caption: strings.depth.bids,
    price: strings.depth.bidPrice,
    total: strings.depth.totalBids,
    priceClass: 'text-up',
    barClass: 'bg-up-soft',
  },
  ask: {
    caption: strings.depth.asks,
    price: strings.depth.askPrice,
    total: strings.depth.totalAsks,
    priceClass: 'text-down',
    barClass: 'bg-down-soft',
  },
} as const;

const ROWS = Array.from({ length: DEPTH_LEVELS }, (_, i) => i);
const cell = 'h-8 px-2 py-0 align-middle';
const numeric = 'text-right font-mono tabular-nums';

type DepthSideProps = {
  side: Side;
  /** Null while loading: the same rows render with skeletons, so nothing moves on arrival. */
  levels: readonly DepthLevel[] | null;
  total: number | null;
  maxQty: number;
};

/**
 * One side of the book as a table: price, orders and quantity for five levels, a bar behind each
 * quantity scaled to the largest level on either side, and the side's total quantity. The caption
 * names the side, so colour is never the only way to tell bids from offers.
 */
function DepthSide({ side, levels, total, maxQty }: DepthSideProps) {
  const labels = SIDE[side];
  return (
    <table className="w-full table-fixed border-collapse text-body" data-side={side}>
      <caption className="pb-1 text-left text-label font-semibold text-ink">
        {labels.caption}
      </caption>
      <colgroup>
        <col className="w-[38%]" />
        <col className="w-[22%]" />
        <col className="w-[40%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className={cn(cell, 'text-left text-label font-medium text-ink-muted')}>
            {labels.price}
          </th>
          <th scope="col" className={cn(cell, 'text-right text-label font-medium text-ink-muted')}>
            {strings.depth.orders}
          </th>
          <th scope="col" className={cn(cell, 'text-right text-label font-medium text-ink-muted')}>
            {strings.depth.qty}
          </th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((i) => {
          const level = levels?.[i];
          return (
            // Rows are keyed by position, not price, so a refresh updates them in place.
            <tr key={i} data-testid={`depth-${side}-row`}>
              <td className={cn(cell, 'font-mono tabular-nums', labels.priceClass)}>
                {level ? formatInr(level.price) : <Skeleton className="h-4 w-16" />}
              </td>
              <td className={cn(cell, numeric, 'text-ink-muted')}>
                {level ? formatCount(level.orders) : <Skeleton className="ml-auto h-4 w-6" />}
              </td>
              <td className={cn(cell, numeric, 'relative text-ink')}>
                {level ? (
                  <>
                    <span
                      aria-hidden="true"
                      data-testid="depth-bar"
                      className={cn('absolute inset-y-1 right-0 rounded-sm', labels.barClass)}
                      style={{ width: `${String(barPercent(level.qty, maxQty))}%` }}
                    />
                    <span className="relative">{formatCount(level.qty)}</span>
                  </>
                ) : (
                  <Skeleton className="ml-auto h-4 w-12" />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-line">
          <th
            scope="row"
            colSpan={2}
            className={cn(cell, 'text-left text-label font-medium text-ink-muted')}
          >
            {labels.total}
          </th>
          <td className={cn(cell, numeric, 'font-semibold text-ink')}>
            {total === null ? <Skeleton className="ml-auto h-4 w-14" /> : formatCount(total)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function DepthBook({ depth }: { depth: Depth | null }) {
  const maxQty = depth ? depthScale(depth) : 0;
  return (
    <div className="@container">
      <div className="grid gap-4 @md:grid-cols-2">
        <DepthSide
          side="bid"
          levels={depth?.bids ?? null}
          total={depth?.totalBidQty ?? null}
          maxQty={maxQty}
        />
        <DepthSide
          side="ask"
          levels={depth?.asks ?? null}
          total={depth?.totalAskQty ?? null}
          maxQty={maxQty}
        />
      </div>
    </div>
  );
}

/**
 * Market depth (T-110): the top five bids and offers with quantity bars and totals. Refreshes
 * every second, but only while the market is open, the card is on screen (IntersectionObserver)
 * and the tab is visible; otherwise the last book stays up. Rows keep a fixed height and the
 * skeleton has the same shape as the book, so loading and refreshing never shift the layout.
 * Equities only.
 */
export function MarketDepthCard({ instrument }: MarketDepthCardProps) {
  const api = useApiClient();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const pageVisible = usePageVisible();
  const marketOpen = useMarketOpen();
  const polling = marketOpen && inView && pageVisible;
  const depth = useQuery({
    ...depthQuery(api, { symbol: instrument.symbol, exchange: instrument.exchange }),
    placeholderData: keepPreviousData,
    refetchInterval: polling ? DEPTH_REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });

  const status = marketOpen
    ? polling
      ? strings.depth.live
      : strings.depth.paused
    : strings.depth.closed;

  return (
    <div ref={ref} data-polling={polling ? 'on' : 'off'}>
      <Card title={strings.depth.title}>
        {depth.data ? (
          <div className="grid gap-3">
            <DepthBook depth={depth.data} />
            <p className="flex flex-wrap justify-between gap-x-3 text-label text-ink-muted">
              <span>{status}</span>
              <span>{strings.depth.asOf(formatIstTime(new Date(depth.data.ts)))}</span>
            </p>
          </div>
        ) : depth.isError ? (
          <ErrorState
            title={strings.depth.errorTitle}
            description={strings.depth.errorBody}
            retryLabel={strings.depth.retry}
            onRetry={() => void depth.refetch()}
          />
        ) : (
          <div role="status" aria-label={strings.depth.loading} className="grid gap-3">
            <DepthBook depth={null} />
            {/* Same text as the loaded status line, invisible, so the card keeps its height. */}
            <p aria-hidden="true" className="invisible text-label">
              {status}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
