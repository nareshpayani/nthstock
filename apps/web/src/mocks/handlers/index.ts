import type { MarketDataAdapter } from '@nthstock/marketData';
import type { RouteHandlerOptions } from '../handlerKit';
import { createAuthMock, type AuthMockOptions } from './auth';
import { marketHandlers } from './market';
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
};

/** Every MSW handler the app uses, REST and WebSocket, over one adapter. */
export function createHandlers({
  adapter,
  wsUrl,
  rest,
  stream,
  auth,
  watchlists,
}: MockHandlersOptions) {
  const authMock = createAuthMock(auth);
  return [
    ...marketHandlers(adapter, rest),
    ...authMock.handlers(rest),
    // Watchlists take the auth clock, so a scenario that moves time moves both.
    ...createWatchlistMock(adapter, authMock, {
      ...(auth?.now ? { now: auth.now } : {}),
      ...watchlists,
    }).handlers(rest),
    quoteStreamHandler(adapter, { ...stream, url: wsUrl }),
  ];
}

export { marketHandlers, MOCK_VERSION } from './market';
export { authHandlers, createAuthMock, MSW_SESSION_COOKIE, type AuthMockOptions } from './auth';
export {
  createWatchlistMock,
  WATCHLIST_MOCK_STORAGE_KEY,
  type WatchlistMockOptions,
} from './watchlists';
export { QUOTE_FLUSH_MS, quoteStreamHandler, type QuoteStreamOptions } from './quoteStream';
