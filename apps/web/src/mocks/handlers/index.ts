import type { MarketDataAdapter } from '@nthstock/marketData';
import type { HttpHandler } from 'msw';
import type { RouteHandlerOptions } from '../handlerKit';
import { createAuthMock, type AuthMockOptions } from './auth';
import { marketHandlers } from './market';
import { createOrdersMock, type OrdersMock, type OrdersMockOptions } from './orders';
import { quoteStreamHandler, type QuoteStreamOptions } from './quoteStream';
import { createWatchlistMock, type WatchlistMockOptions } from './watchlists';

export type MockHandlersOptions = {
  adapter: MarketDataAdapter;
  /** WebSocket URL the quote stream intercepts. */
  wsUrl: string;
  rest?: RouteHandlerOptions;
  stream?: Omit<QuoteStreamOptions, 'url'>;
  auth?: AuthMockOptions;
  watchlists?: WatchlistMockOptions;
  orders?: OrdersMockOptions;
};

/**
 * Every MSW handler the app uses, REST and WebSocket, over one adapter, plus the orders mock (tests
 * and scenarios script its prices).
 */
export function createMockHandlers({
  adapter,
  wsUrl,
  rest,
  stream,
  auth,
  watchlists,
  orders,
}: MockHandlersOptions): { handlers: RequestHandlers; orders: OrdersMock } {
  const authMock = createAuthMock(auth);
  // Watchlists and orders take the auth clock, so a scenario that moves time moves all three.
  const now = auth?.now ? { now: auth.now } : {};
  const ordersMock = createOrdersMock(adapter, authMock, { ...now, ...orders });
  return {
    handlers: [
      ...marketHandlers(adapter, rest),
      ...authMock.handlers(rest),
      ...createWatchlistMock(adapter, authMock, { ...now, ...watchlists }).handlers(rest),
      ...ordersMock.handlers(rest),
      quoteStreamHandler(adapter, {
        ...stream,
        url: wsUrl,
        orders: { onOrderUpdate: ordersMock.onOrderUpdate, activeUserId: authMock.activeUserId },
      }),
    ],
    orders: ordersMock,
  };
}

type RequestHandlers = (HttpHandler | ReturnType<typeof quoteStreamHandler>)[];

/** Every MSW handler the app uses, REST and WebSocket, over one adapter. */
export function createHandlers(options: MockHandlersOptions): RequestHandlers {
  return createMockHandlers(options).handlers;
}

export { marketHandlers, MOCK_VERSION } from './market';
export { authHandlers, createAuthMock, MSW_SESSION_COOKIE, type AuthMockOptions } from './auth';
export {
  createWatchlistMock,
  WATCHLIST_MOCK_STORAGE_KEY,
  type WatchlistMockOptions,
} from './watchlists';
export {
  QUOTE_FLUSH_MS,
  quoteStreamHandler,
  type OrderUpdateSource,
  type QuoteStreamOptions,
} from './quoteStream';
export {
  ORDER_SWEEP_MS,
  ORDERS_MOCK_STORAGE_KEY,
  createOrdersMock,
  type OrdersMock,
  type OrdersMockOptions,
} from './orders';
