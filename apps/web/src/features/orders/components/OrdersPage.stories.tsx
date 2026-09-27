import { createApiClient } from '@nthstock/apiClient';
import type { Order, OrderHistoryEntry } from '@nthstock/contracts';
import { ToastProvider } from '@nthstock/ui';
import { fixedClock, fromIst } from '@nthstock/utils';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiClientContext } from '@/shared/lib/apiClientContext';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';
import type { OrderTab } from '../model/orderBook';
import { OrdersPage, type OrdersSearch } from './OrdersPage';

/** Monday 28 Sep 2026: the story's "today". Made-up paper orders only. */
const at = (minute: number) => fromIst(2026, 9, 28, minute).toISOString();
const base: Order = {
  id: 'pe_story1',
  clientOrderId: null,
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 10,
  price: 151_000,
  filledQty: 0,
  avgFillPrice: null,
  status: 'OPEN',
  statusReason: null,
  placedAt: at(10 * 60 + 5),
  updatedAt: at(10 * 60 + 5),
};

const ORDERS: Order[] = [
  { ...base, id: 'pe_story6', symbol: 'HDFCBANK', side: 'SELL', qty: 4, price: 172_550 },
  { ...base, id: 'pe_story5', symbol: 'TCS', status: 'AMO', type: 'MARKET', price: null, qty: 2 },
  {
    ...base,
    id: 'pe_story4',
    type: 'MARKET',
    price: null,
    status: 'EXECUTED',
    filledQty: 10,
    avgFillPrice: 151_235,
  },
  {
    ...base,
    id: 'pe_story3',
    symbol: 'WIPRO',
    status: 'CANCELLED',
    statusReason: 'Cancelled by you.',
    qty: 25,
    price: 29_500,
  },
  {
    ...base,
    id: 'pe_story2',
    symbol: 'RELIANCE',
    type: 'MARKET',
    price: null,
    product: 'INTRADAY',
    qty: 1_000,
    status: 'REJECTED',
    statusReason: 'Not enough cash: this order needs ₹29,85,000.00 and ₹10,00,000.00 is available.',
  },
];

const HISTORY: Record<string, OrderHistoryEntry[]> = {
  pe_story4: [
    {
      event: 'PLACED',
      status: 'OPEN',
      at: at(10 * 60 + 5),
      qty: 10,
      type: 'MARKET',
      price: null,
      fillPrice: null,
      note: null,
    },
    {
      event: 'EXECUTED',
      status: 'EXECUTED',
      at: at(10 * 60 + 5),
      qty: 10,
      type: 'MARKET',
      price: null,
      fillPrice: 151_235,
      note: null,
    },
  ],
  pe_story2: [
    {
      event: 'PLACED',
      status: 'REJECTED',
      at: at(10 * 60 + 2),
      qty: 1_000,
      type: 'MARKET',
      price: null,
      fillPrice: null,
      note: 'Not enough cash: this order needs ₹29,85,000.00 and ₹10,00,000.00 is available.',
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A REST client that answers the order book routes from the fixed orders above. */
function storyApi(orders: readonly Order[]) {
  return createApiClient({
    baseUrl: 'http://story.test',
    fetch: (input) => {
      const url = new URL(input);
      const history = /^\/v1\/orders\/([^/]+)\/history$/.exec(url.pathname);
      const one = /^\/v1\/orders\/([^/]+)$/.exec(url.pathname);
      if (url.pathname === '/v1/orders')
        return Promise.resolve(json({ items: orders, nextCursor: null }));
      if (history?.[1]) {
        const items = HISTORY[history[1]];
        return Promise.resolve(
          items
            ? json({ orderId: history[1], items })
            : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404),
        );
      }
      const order = one?.[1] ? orders.find((o) => o.id === one[1]) : undefined;
      return Promise.resolve(
        order ? json(order) : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404),
      );
    },
  });
}

type DemoProps = { tab: OrderTab; order?: string; empty?: boolean };

function Demo({ tab, order, empty = false }: DemoProps) {
  const [setup] = useState(() => ({
    api: storyApi(empty ? [] : ORDERS),
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    }),
  }));
  const [search, setSearch] = useState<OrdersSearch>({ tab, ...(order ? { order } : {}) });
  return (
    <QueryClientProvider client={setup.queryClient}>
      <ApiClientContext.Provider value={setup.api}>
        <MarketSessionContext.Provider
          value={{ clock: fixedClock(fromIst(2026, 9, 28, 11 * 60)), alwaysOpen: false }}
        >
          <ToastProvider>
            <div className="bg-canvas p-4">
              <OrdersPage
                search={search}
                onSearchChange={(patch) => setSearch((current) => ({ ...current, ...patch }))}
              />
            </div>
          </ToastProvider>
        </MarketSessionContext.Provider>
      </ApiClientContext.Provider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Orders/OrdersPage',
  component: Demo,
  args: { tab: 'open' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open orders (an OPEN limit sell and an AMO) with Details, Modify and Cancel. */
export const Open: Story = {};
/** Executed: the fill price in the price column. */
export const Executed: Story = { args: { tab: 'executed' } };
/** Cancelled and Rejected together, each saying which in words. */
export const CancelledAndRejected: Story = { args: { tab: 'cancelled' } };
/** Nothing yet: an empty state per tab. */
export const Empty: Story = { args: { tab: 'open', empty: true } };
/** The detail drawer of a rejected order: the reason and the status timeline in IST. */
export const RejectedDetail: Story = { args: { tab: 'cancelled', order: 'pe_story2' } };
/** The detail drawer of an executed order. */
export const ExecutedDetail: Story = { args: { tab: 'executed', order: 'pe_story4' } };
