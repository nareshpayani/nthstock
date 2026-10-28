import type { TradingState } from '@nthstock/apiClient';
import type { Instrument, Order } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { Link } from '@tanstack/react-router';
import { useCallback } from 'react';
import { PendingPrice } from '@/shared/components/PendingPrice';
import { usePendingOrderPrices } from '@/shared/hooks/usePendingOrderPrices';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import { strings } from '../strings';

const selectStatus = (state: TradingState) => state.status;
const sameOrders = (a: readonly Order[], b: readonly Order[]) =>
  a.length === b.length && a.every((order, i) => order.id === b[i]?.id && order.seq === b[i].seq);

const linkClass =
  'inline-flex min-h-11 items-center text-body font-medium text-brand underline-offset-2 hover:underline';

/**
 * The phone Orders tab (T12, SPEC-TFC-1 §9.4): today's orders in this instrument, newest first,
 * from the trading store, with a link to the full order book. Where the store is idle (api mode)
 * or failed to load, it points to the Orders page instead; while loading it says so. "No orders"
 * is shown only once the orders are known.
 */
export function InstrumentOrders({ instrument }: { instrument: Instrument }) {
  const status = useTradingSelector(selectStatus);
  const select = useCallback(
    (state: TradingState) => state.orders.filter((order) => order.token === instrument.token),
    [instrument.token],
  );
  const orders = useTradingSelector(select, sameOrders);
  const pendingPrices = usePendingOrderPrices();
  const text = strings.phone.orders;
  const all = (
    <Link to="/orders" className={linkClass}>
      {text.all}
    </Link>
  );
  if (status === 'loading') {
    return (
      <div role="status" className="grid gap-1 px-1">
        <p className="text-body text-ink-muted">{text.loading}</p>
      </div>
    );
  }
  if (status === 'idle' || status === 'error') {
    return (
      <div className="grid gap-1 px-1">
        <p className="text-body text-ink-muted">
          {status === 'error' ? text.failed : text.unavailable}
        </p>
        {all}
      </div>
    );
  }
  return (
    <div className="grid gap-2 px-1">
      {orders.length === 0 ? (
        <p className="text-body text-ink-muted">{text.empty(instrument.symbol)}</p>
      ) : (
        <ul aria-label={text.label(instrument.symbol)} className="grid divide-y divide-line">
          {orders.map((order) => (
            <li key={order.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-body">
                {text.row(
                  text.sides[order.side],
                  order.filledQty,
                  order.qty,
                  text.types[order.type],
                )}
                {order.price === null ? null : (
                  <span className="ml-1 font-mono text-ink-muted tabular-nums">
                    {formatInr(order.price)}
                  </span>
                )}
                <PendingPrice pending={pendingPrices.get(order.id)} />
              </span>
              <span className="shrink-0 text-label font-semibold text-ink-muted">
                {text.statuses[order.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {all}
    </div>
  );
}
