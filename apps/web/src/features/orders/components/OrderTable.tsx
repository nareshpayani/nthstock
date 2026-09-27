import type { Order } from '@nthstock/contracts';
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
import { isLive, orderName, orderTimeLabel, priceLabel } from '../model/orderBook';
import { strings } from '../strings';
import { OrderSideLabel, OrderStatusBadge } from './OrderStatusBadge';

/** Above this many rows the book is virtualised (ADR 0005: TanStack Virtual over 50 rows). */
export const VIRTUAL_ORDER_ROWS = 50;
const ROW_HEIGHT = 48;
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
};

type Column = {
  key: string;
  header: string;
  numeric?: boolean;
  render: (order: Order) => ReactNode;
};

/**
 * The order rows (T-144): time in IST, stock, side, type, product, filled/total quantity, price
 * and status, with Details on every row and Modify and Cancel on open orders (T-145). Up to 50
 * rows render as a table; a longer book scrolls in a virtualised grid.
 */
export function OrderTable({ orders, label, now, onDetails, onModify, onCancel }: OrderTableProps) {
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
      render: (order) => strings.qty(order.filledQty, order.qty),
    },
    { key: 'price', header: strings.columns.price, numeric: true, render: priceLabel },
    {
      key: 'status',
      header: strings.columns.status,
      render: (order) => <OrderStatusBadge status={order.status} />,
    },
    {
      key: 'actions',
      header: strings.columns.actions,
      render: (order) => {
        const name = orderName(order);
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
          </div>
        );
      },
    },
  ];

  if (orders.length > VIRTUAL_ORDER_ROWS) {
    return (
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
