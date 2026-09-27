import { isApiError } from '@nthstock/apiClient';
import type { Order } from '@nthstock/contracts';
import { ErrorState, IconAlert, Sheet, Skeleton, cn } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useQuery } from '@tanstack/react-query';
import { useContext, type ReactNode, type RefObject } from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';
import { orderDetailQuery, orderHistoryQuery } from '../api/ordersQuery';
import { orderTimeLabel } from '../model/orderBook';
import { orderTimeline } from '../model/orderTimeline';
import { strings } from '../strings';
import { OrderSideLabel, OrderStatusBadge } from './OrderStatusBadge';

export type OrderDetailSheetProps = {
  /** The order to show; null keeps the drawer closed. */
  orderId: string | null;
  /** A row's copy of the order, shown while the drawer loads its own. */
  initial?: Order | undefined;
  onClose: () => void;
  /** Where focus goes when the drawer closes (the Details button that opened it). */
  returnFocus?: RefObject<HTMLElement | null>;
};

const dotTone = { neutral: 'bg-ink-muted', up: 'bg-up', down: 'bg-down' } as const;

function Timeline({ orderId }: { orderId: string }) {
  const api = useApiClient();
  const history = useQuery(orderHistoryQuery(api, orderId));
  if (history.isPending) {
    return (
      <div role="status" aria-label={strings.detail.timelineLoading} className="grid gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (history.isError) {
    return <p className="text-body text-ink-muted">{strings.detail.timelineError}</p>;
  }
  const steps = orderTimeline(history.data.items);
  return (
    <ol aria-label={strings.detail.timeline} className="grid gap-0">
      {steps.map((step, index) => (
        <li key={`${step.event}-${step.at}-${String(index)}`} className="flex gap-3">
          <div className="flex flex-col items-center" aria-hidden="true">
            <span className={cn('mt-1.5 size-2.5 rounded-pill', dotTone[step.tone])} />
            {index < steps.length - 1 ? <span className="w-px flex-1 bg-line" /> : null}
          </div>
          <div className="grid gap-0.5 pb-4">
            <p className="text-body font-semibold text-ink">{step.label}</p>
            <p className="text-label text-ink-muted">
              <time dateTime={step.at} className="font-mono tabular-nums">
                {`${step.time} IST, ${step.date}`}
              </time>
            </p>
            <p className="text-label text-ink">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Details({ order }: { order: Order }) {
  const { clock } = useContext(MarketSessionContext);
  const rows: [string, ReactNode][] = [
    [strings.detail.fields.status, <OrderStatusBadge key="status" status={order.status} />],
    [strings.detail.fields.side, <OrderSideLabel key="side" side={order.side} />],
    [strings.detail.fields.type, strings.types[order.type]],
    [strings.detail.fields.product, strings.products[order.product]],
    [strings.detail.fields.qty, String(order.qty)],
    [strings.detail.fields.filled, String(order.filledQty)],
    [strings.detail.fields.price, order.price === null ? strings.atMarket : formatInr(order.price)],
    [
      strings.detail.fields.avgFill,
      order.avgFillPrice === null ? '—' : formatInr(order.avgFillPrice),
    ],
    [strings.detail.fields.placed, `${orderTimeLabel(order.placedAt, clock.now())} IST`],
    [strings.detail.fields.id, order.id],
  ];
  const reasonTitle =
    order.status === 'REJECTED'
      ? strings.detail.rejectionReason
      : order.status === 'CANCELLED'
        ? strings.detail.cancelReason
        : null;
  return (
    <div className="grid gap-4">
      {reasonTitle && order.statusReason ? (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border border-l-4 border-line bg-surface p-3',
            order.status === 'REJECTED' ? 'border-l-down' : 'border-l-ink-muted',
          )}
        >
          <IconAlert
            size={18}
            className={cn(
              'mt-0.5 shrink-0',
              order.status === 'REJECTED' ? 'text-down' : 'text-ink-muted',
            )}
          />
          <div className="grid gap-0.5">
            <p className="text-body font-semibold text-ink">{reasonTitle}</p>
            <p className="text-label text-ink">{order.statusReason}</p>
          </div>
        </div>
      ) : null}
      <dl className="grid gap-2 rounded-md border border-line p-3">
        {rows.map(([term, detail]) => (
          <div key={term} className="flex justify-between gap-4">
            <dt className="text-label text-ink-muted">{term}</dt>
            <dd className="text-right text-body font-medium break-all text-ink">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DetailBody({ orderId, initial }: { orderId: string; initial: Order | undefined }) {
  const api = useApiClient();
  const detail = useQuery({
    ...orderDetailQuery(api, orderId),
    ...(initial ? { placeholderData: initial } : {}),
  });
  if (detail.isError && !detail.data) {
    const missing = isApiError(detail.error) && detail.error.status === 404;
    return (
      <ErrorState
        title={missing ? strings.detail.notFound : strings.detail.loadError}
        {...(missing
          ? {}
          : { onRetry: () => void detail.refetch(), retryLabel: strings.detail.retry })}
        description=""
      />
    );
  }
  if (!detail.data) {
    return (
      <div role="status" aria-label={strings.detail.loading} className="grid gap-3 p-4">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return (
    <div className="grid gap-6 p-4">
      <Details order={detail.data} />
      <section className="grid gap-3" aria-labelledby="order-timeline-heading">
        <h3 id="order-timeline-heading" className="text-body font-semibold text-ink">
          {strings.detail.timeline}
        </h3>
        <Timeline orderId={orderId} />
      </section>
    </div>
  );
}

/**
 * The order detail drawer (T-146): the order's terms, the reason it was rejected or cancelled,
 * and its status timeline, every step with its IST time. It refetches with the order book on
 * every order update.
 */
export function OrderDetailSheet({
  orderId,
  initial,
  onClose,
  returnFocus,
}: OrderDetailSheetProps) {
  return (
    <Sheet
      open={orderId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={initial ? strings.detail.title(initial.symbol) : strings.detail.titleFallback}
      description={strings.detail.description}
      {...(returnFocus ? { returnFocus } : {})}
      className="w-[min(440px,calc(100vw-24px))]"
    >
      {orderId ? <DetailBody orderId={orderId} initial={initial} /> : null}
    </Sheet>
  );
}
