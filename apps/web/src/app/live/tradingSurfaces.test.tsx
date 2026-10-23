import { createApiClient, createTradingStore, type TradingSource } from '@nthstock/apiClient';
import type {
  AccountState,
  Depth,
  FundsSummary,
  Instrument,
  Order,
  Position,
  TrailingStop,
  WsAccountDelta,
} from '@nthstock/contracts';
import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import type { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrderUpdatesBridge, OrdersPage } from '@/features/orders';
import { PositionsPage } from '@/features/positions';
import { MarketDepthCard } from '@/features/stockDetail';
import { resetFillToasts } from '@/shared/lib/fillToasts';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import type { OrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { installIntersectionObserver } from '@/test/intersectionObserver';
import { testOrder } from '@/test/orders';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession, signIn } from '@/test/session';
import { writeTradingCommit } from './tradingCache';

/**
 * The existing surfaces on the trading store (T11, REQ-TFC-08): one `accountDelta` frame with a
 * partial fill moves the order book, the positions page and the market depth together, toasts the
 * partial fill, and shows the position's trailing stop with its status and stop.
 */

const OPEN: MarketSession = {
  clock: fixedClock(fromIst(2026, 9, 28, 10 * 60)),
  alwaysOpen: false,
};
const AT = '2026-09-28T04:30:01.000Z';

const instrument: Instrument = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  name: 'Infosys Ltd',
  type: 'EQUITY',
  isin: 'INE009A01021',
  sector: 'Information Technology',
  lotSize: 1,
  tickSize: 5,
};

const level = (price: number, qty: number) => ({ price, qty, orders: 2 });
const depthAt = (bid: number, ts: string): Depth => ({
  token: instrument.token,
  symbol: 'INFY',
  exchange: 'NSE',
  bids: [0, 5, 10, 15, 20].map((step) => level(bid - step, 100)),
  asks: [5, 10, 15, 20, 25].map((step) => level(bid + step, 100)),
  totalBidQty: 500,
  totalAskQty: 500,
  ts,
});

const funds: FundsSummary = {
  openingBalance: 100_000_000,
  balance: 100_000_000,
  blocked: 1_510_000,
  available: 98_490_000,
  realisedPnlToday: 0,
  asOf: AT,
};

const open = testOrder({ id: 'pe_1', qty: 10, price: 151_000, seq: 1 });
const partly: Order = { ...open, filledQty: 3, avgFillPrice: 151_000, seq: 2, updatedAt: AT };
const position: Position = {
  token: instrument.token,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'DELIVERY',
  netQty: 3,
  buyQty: 3,
  sellQty: 0,
  avgBuyPrice: 151_000,
  avgSellPrice: 0,
  ltp: 151_000,
  realisedPnl: 0,
  unrealisedPnl: 0,
};
const stop: TrailingStop = {
  id: 'ts_1',
  token: instrument.token,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'DELIVERY',
  direction: 'LONG',
  trail: { unit: 'AMOUNT', amount: 1_000 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
  status: 'TRAILING',
  statusReason: null,
  watermarkPrice: 151_000,
  stopPrice: 150_000,
  protectedQty: 3,
  entryOrderId: 'pe_1',
  exitOrderId: null,
  seq: 2,
  createdAt: AT,
  updatedAt: AT,
};

const snapshot: AccountState = {
  seq: 1,
  orders: [open],
  positions: [],
  trailingStops: [],
  funds,
};
const restDepth = depthAt(150_900, '2026-09-28T04:30:00.000Z');
const frameDepth = depthAt(151_200, AT);

/** REST for the pages' first load: the book, no positions yet, and the depth before the frame. */
const api = createApiClient({
  baseUrl: 'http://surfaces.test',
  fetch: (input) => {
    const { pathname } = new URL(input);
    const body =
      pathname === '/v1/orders'
        ? { items: [open], nextCursor: null }
        : pathname === '/v1/positions'
          ? { items: [] }
          : pathname.endsWith('/depth')
            ? restDepth
            : null;
    return Promise.resolve(
      body === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
    );
  },
});

function fakeSources() {
  const frames = new Set<(delta: WsAccountDelta) => void>();
  const updates = new Set<(order: Order) => void>();
  const focused: (string | null)[] = [];
  const source: TradingSource = {
    onAccountDelta: (listener) => {
      frames.add(listener);
      return () => frames.delete(listener);
    },
    focus: (symbol) => focused.push(symbol),
  };
  const orderUpdates: OrderUpdateSource = {
    onOrderUpdate: (listener) => {
      updates.add(listener);
      return () => updates.delete(listener);
    },
    connect: () => undefined,
  };
  /** One frame, as the socket delivers it: the store and the order-update listeners both see it. */
  const send = (delta: WsAccountDelta) => {
    for (const listener of frames) listener(delta);
    for (const order of delta.orders) for (const listener of updates) listener(order);
  };
  return { source, orderUpdates, send, focused };
}

beforeEach(() => {
  installResizeObserver();
  installIntersectionObserver();
  signIn();
});
afterEach(() => {
  resetSession();
  resetFillToasts();
});

describe('surfaces on the trading store (T11, REQ-TFC-08)', () => {
  it('moves the order book, positions and depth from one frame with a partial fill', async () => {
    const { source, orderUpdates, send, focused } = fakeSources();
    let queryClient: QueryClient | null = null;
    const store = createTradingStore({
      source,
      loadState: () => Promise.resolve(snapshot),
      schedule: (flush) => queueMicrotask(flush),
      onCommit: (commit) => {
        if (queryClient) writeTradingCommit(queryClient, commit);
      },
    });
    const view = renderWithProviders(
      <>
        <OrdersPage search={{}} onSearchChange={() => undefined} />
        <PositionsPage />
        <MarketDepthCard instrument={instrument} />
        <OrderUpdatesBridge />
      </>,
      { apiClient: api, tradingStore: store, marketSession: OPEN, orderUpdates },
    );
    queryClient = view.queryClient;
    await store.start();

    const book = await screen.findByRole('table', { name: /open orders/i });
    expect(within(book).getByText('0 / 10')).toBeInTheDocument();
    await screen.findByText(formatInr(restDepth.bids[0]?.price ?? 0));
    await waitFor(() => expect(focused).toContain('INFY'));

    send({
      v: 1,
      type: 'accountDelta',
      seq: 2,
      at: AT,
      quotes: [],
      depth: frameDepth,
      orders: [partly],
      positions: [position],
      trailingStops: [stop],
      funds,
    });

    // Every surface shows the frame: the partial fill, the new position with its stop, the book.
    await waitFor(() => {
      expect(within(book).getByText('3 / 10 filled')).toBeInTheDocument();
      expect(within(book).getByText('Partly filled')).toBeInTheDocument();
      const positions = screen.getByRole('table', { name: /positions/i });
      expect(within(positions).getByText('3')).toBeInTheDocument();
      expect(within(positions).getByTestId('trailing-stop-badge')).toHaveTextContent(
        `Trailing SLTrailing · stop ${formatInr(150_000)}`,
      );
      expect(screen.getAllByTestId('depth-bid-row')[0]).toHaveTextContent(
        formatInr(frameDepth.bids[0]?.price ?? 0),
      );
    });
    expect(within(book).getByTestId('trailing-stop-badge')).toHaveTextContent('Trailing');
    expect(await screen.findByText('Order partly filled')).toBeInTheDocument();
    expect(screen.getByText(`BUY 3 / 10 INFY @ ${formatInr(151_000)}`)).toBeInTheDocument();
    store.dispose();
  });
});
