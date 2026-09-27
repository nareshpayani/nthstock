import type { Exchange } from '@nthstock/contracts';
import { Skeleton } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useWatch, type Control } from 'react-hook-form';
import { useQuote } from '@/shared/hooks/useQuote';
import { orderValue, type TicketFormValues } from '../model/ticketForm';
import { strings } from '../strings';

export type OrderEstimateProps = {
  symbol: string;
  exchange: Exchange;
  control: Control<TicketFormValues>;
  /** LTP from the REST snapshot, used until the first live quote. */
  snapshotLtp: number | null | undefined;
  /** Available paper cash in paise; undefined while funds load or when they failed. */
  available: number | undefined;
  fundsLoading: boolean;
};

/**
 * Required amount (buy) or estimated value (sell) and available cash, live (T-136): a market
 * order is valued at the live LTP, so only this small block re-renders on each tick, not the form.
 */
export function OrderEstimate({
  symbol,
  exchange,
  control,
  snapshotLtp,
  available,
  fundsLoading,
}: OrderEstimateProps) {
  const [side, type, qty, price] = useWatch({ control, name: ['side', 'type', 'qty', 'price'] });
  const live = useQuote(symbol, exchange);
  const value = orderValue({ type, qty, price }, live?.quote.ltp ?? snapshotLtp);
  const short = side === 'BUY' && value !== null && available !== undefined && value > available;
  return (
    <div className="grid gap-1 rounded-md bg-canvas p-3">
      <dl className="grid grid-cols-2 gap-4">
        <div className="grid gap-0.5">
          <dt className="text-label text-ink-muted">
            {side === 'BUY' ? strings.form.requiredAmount : strings.form.estimatedValue}
          </dt>
          <dd
            className="font-mono text-body font-semibold text-ink tabular-nums"
            data-testid="order-value"
          >
            {value === null ? strings.form.unknownAmount : formatInr(value)}
          </dd>
        </div>
        <div className="grid gap-0.5 text-right">
          <dt className="text-label text-ink-muted">{strings.form.availableCash}</dt>
          <dd className="font-mono text-body text-ink tabular-nums" data-testid="available-cash">
            {available !== undefined ? (
              formatInr(available)
            ) : fundsLoading ? (
              <Skeleton className="ml-auto inline-block h-5 w-24 align-middle" />
            ) : (
              strings.form.unknownAmount
            )}
          </dd>
        </div>
      </dl>
      {short ? (
        <p className="text-label font-medium text-down">{strings.form.notEnoughCash}</p>
      ) : null}
    </div>
  );
}
