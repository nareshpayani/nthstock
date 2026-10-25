import type { MarketDataAdapter } from '@nthstock/marketData';
import type { HttpHandler } from 'msw';
import type { RouteHandlerOptions } from '../handlerKit';
import { createAlertsMock, type AlertsMock, type AlertsMockOptions } from './alerts';
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
  alerts?: AlertsMockOptions;
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
  alerts,
}: MockHandlersOptions): { handlers: RequestHandlers; orders: OrdersMock; alerts: AlertsMock } {
  const authMock = createAuthMock(auth);
  // Watchlists and orders take the auth clock, so a scenario that moves time moves all three.
  const now = auth?.now ? { now: auth.now } : {};
  const ordersMock = createOrdersMock(adapter, authMock, { ...now, ...orders });
  const alertsMock = createAlertsMock(adapter, authMock, ordersMock, { ...now, ...alerts });
  return {
    handlers: [
      ...marketHandlers(adapter, rest),
      ...authMock.handlers(rest),
      ...createWatchlistMock(adapter, authMock, { ...now, ...watchlists }).handlers(rest),
      ...ordersMock.handlers(rest),
      ...alertsMock.handlers(rest),
      quoteStreamHandler(adapter, {
        ...stream,
        url: wsUrl,
        orders: {
          onOrderUpdate: ordersMock.onOrderUpdate,
          onTrailingStopUpdate: ordersMock.onTrailingStopUpdate,
          accountState: ordersMock.accountState,
          activeUserId: authMock.activeUserId,
          onNotification: alertsMock.onNotification,
        },
      }),
    ],
    orders: ordersMock,
    alerts: alertsMock,
  };
}

type RequestHandlers = (HttpHandler | ReturnType<typeof quoteStreamHandler>)[];

export { type AuthMockOptions } from './auth';
export { WATCHLIST_MOCK_STORAGE_KEY, type WatchlistMockOptions } from './watchlists';
export { type OrderUpdateSource, type QuoteStreamOptions } from './quoteStream';
export { type AlertsMock, type AlertsMockOptions } from './alerts';
export {
  ORDER_SWEEP_MS,
  ORDERS_MOCK_STORAGE_KEY,
  READABLE_SAVED_VERSIONS,
  type OrdersMock,
  type OrdersMockOptions,
} from './orders';
