import {
  TERMINAL_TRAILING_STOP_STATUSES,
  type Order,
  type TrailingStop,
} from '@nthstock/contracts';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VirtualCell,
  VirtualHeaderCell,
  VirtualList,
} from '@nthstock/ui';
import type { ReactNode } from 'react';
import { PendingPrice } from '@/shared/components/PendingPrice';
import { TrailingStopBadge } from '@/shared/components/TrailingStopBadge';
import type { PendingOrderPrice } from '@/shared/hooks/usePendingOrderPrices';
import { usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { usePositionEditorStore } from '@/shared/lib/positionEditorStore';
import { isLive, isPartlyFilled, orderName, orderTimeLabel, priceLabel } from '../model/orderBook';
import { strings } from '../strings';
import { OrderSideLabel, OrderStatusBadge } from './OrderStatusBadge';

/** Above this many rows the book is virtualised (ADR 0005: TanStack Virtual over 50 rows). */
export const VIRTUAL_ORDER_ROWS = 50;
const ROW_HEIGHT = 48;
const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_TRAILING_STOP_STATUSES);
const VIRTUAL_COLUMNS =
  'minmax(104px,1.1fr) minmax(88px,1fr) 56px 64px 80px 88px minmax(96px,1fr) 96px minmax(220px,1.4fr)';

export type OrderTableProps = {
  orders: readonly Order[];
  /** Accessible name of the table, e.g. "Open orders". */
  label: string;
  now: Date;
  onDetails: (order: Order, trigger: HTMLElement) => void;
  onModify: (order: Order) => void;
  onCancel: (order: Order, trigger: HTMLElement) => void;
  /** Trailing stops by the id of their entry or exit order (T11): shown beside the status. */
  stops?: ReadonlyMap<string, TrailingStop>;
  /** Prices orders are moving to from a chart drag (T16): shown under the price. */
  pendingPrices?: ReadonlyMap<string, PendingOrderPrice>;
};

type Column = {
  key: string;
  header: string;
  numeric?: boolean;
  render: (order: Order) => ReactNode;
};

/**
 * The order rows (T-144): time in IST, stock, side, type, product, filled/total quantity, price
 * and status, with Details on every row, Modify and Cancel on open orders (T-145), and Edit stop on
 * an order whose trailing stop is still active, which opens the position editor (NSTOCK-0395). Up to 50
 * rows render as a table (a list on a phone); a longer book scrolls in a virtualised grid.
 */
export function OrderTable({
  orders,
  label,
  now,
  onDetails,
  onModify,
  onCancel,
  stops,
  pendingPrices,
}: OrderTableProps) {
  const openEditor = usePositionEditorStore((s) => s.openEditor);
  const phone = usePhoneLayout();
  // Details on every row, Modify and Cancel on open orders, Edit stop while a trailing stop is active.
  const actions = (order: Order) => {
    const name = orderName(order);
    const stop = stops?.get(order.id);
    const editable = stop !== undefined && !TERMINAL.has(stop.status);
    return (
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label={strings.actions.detailsLabel(name)}
          onClick={(event) => onDetails(order, event.currentTarget)}
        >
          {strings.actions.details}
        </Button>
        {isLive(order) ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              aria-label={strings.actions.modifyLabel(name)}
              onClick={() => onModify(order)}
            >
              {strings.actions.modify}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label={strings.actions.cancelLabel(name)}
              onClick={(event) => onCancel(order, event.currentTarget)}
            >
              {strings.actions.cancel}
            </Button>
          </>
        ) : null}
        {editable ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={strings.actions.editStopLabel(name)}
            onClick={() =>
              openEditor({
                symbol: stop.symbol,
                exchange: stop.exchange,
                token: stop.token,
                product: stop.product,
                tab: 'stop',
              })
            }
          >
            {strings.actions.editStop}
          </Button>
        ) : null}
      </div>
    );
  };
  const columns: Column[] = [
    {
      key: 'time',
      header: strings.columns.time,
      render: (order) => (
        <time dateTime={order.placedAt} className="font-mono text-label tabular-nums">
          {orderTimeLabel(order.placedAt, now)}
        </time>
      ),
    },
    {
      key: 'stock',
      header: strings.columns.stock,
      render: (order) => (
        <span className="font-semibold">
          {order.symbol}
          <span className="ml-1 text-label font-normal text-ink-muted">{order.exchange}</span>
        </span>
      ),
    },
    {
      key: 'side',
      header: strings.columns.side,
      render: (order) => <OrderSideLabel side={order.side} />,
    },
    { key: 'type', header: strings.columns.type, render: (order) => strings.types[order.type] },
    {
      key: 'product',
      header: strings.columns.product,
      render: (order) => strings.products[order.product],
    },
    {
      key: 'qty',
      header: strings.columns.qty,
      numeric: true,
      render: (order) =>
        isPartlyFilled(order)
          ? strings.partQty(order.filledQty, order.qty)
          : strings.qty(order.filledQty, order.qty),
    },
    {
      key: 'price',
      header: strings.columns.price,
      numeric: true,
      render: (order) => {
        return (
          <>
            {priceLabel(order)}
            <PendingPrice pending={pendingPrices?.get(order.id)} />
          </>
        );
      },
    },
    {
      key: 'status',
      header: strings.columns.status,
      render: (order) => {
        const stop = stops?.get(order.id);
        return (
          <span className="inline-flex items-center gap-1">
            <OrderStatusBadge status={order.status} partial={isPartlyFilled(order)} />
            {stop ? <TrailingStopBadge stop={stop} /> : null}
          </span>
        );
      },
    },
    { key: 'actions', header: strings.columns.actions, render: (order) => actions(order) },
  ];

  // On a phone each order is a two-line row with its actions under it, so nothing is cut off or
  // scrolls sideways. A long book keeps the virtualised grid, which scrolls inside its card.
  if (phone && orders.length <= VIRTUAL_ORDER_ROWS) {
    return (
      <ul aria-label={label} className="grid divide-y divide-line" data-layout="phone">
        {orders.map((order) => {
          const stop = stops?.get(order.id);
          return (
            <li key={order.id} data-order-id={order.id} className="grid gap-1.5 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-semibold">
                  {order.symbol}
                  <span className="ml-1 text-label font-normal text-ink-muted">
                    {order.exchange}
                  </span>
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  {priceLabel(order)}
                  <PendingPrice pending={pendingPrices?.get(order.id)} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink-muted">
                <OrderSideLabel side={order.side} />
                <span>{strings.types[order.type]}</span>
                <span>{strings.products[order.product]}</span>
                <span className="font-mono tabular-nums">
                  {isPartlyFilled(order)
                    ? strings.partQty(order.filledQty, order.qty)
                    : strings.qty(order.filledQty, order.qty)}
                </span>
                <time dateTime={order.placedAt} className="ml-auto font-mono tabular-nums">
                  {orderTimeLabel(order.placedAt, now)}
                </time>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <OrderStatusBadge status={order.status} partial={isPartlyFilled(order)} />
                  {stop ? <TrailingStopBadge stop={stop} /> : null}
                </span>
                {actions(order)}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  if (orders.length > VIRTUAL_ORDER_ROWS) {
    return (
      <div className="relative overflow-x-auto" data-testid="order-virtual-scroller">
        <VirtualList
          items={orders}
          label={label}
          rowHeight={ROW_HEIGHT}
          height="min(70dvh, 640px)"
          columns={VIRTUAL_COLUMNS}
          className="min-w-[960px]"
          getKey={(order) => order.id}
          header={columns.map((column) => (
            <VirtualHeaderCell key={column.key} numeric={column.numeric ?? false}>
              {column.header}
            </VirtualHeaderCell>
          ))}
          renderRow={(order) =>
            columns.map((column) => (
              <VirtualCell key={column.key} numeric={column.numeric ?? false}>
                {column.render(order)}
              </VirtualCell>
            ))
          }
        />
      </div>
    );
  }

  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} numeric={column.numeric ?? false}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id} data-order-id={order.id}>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                numeric={column.numeric ?? false}
                className="whitespace-nowrap"
              >
                {column.render(order)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
