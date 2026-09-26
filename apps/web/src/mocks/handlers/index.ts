import type { MarketDataAdapter } from '@nthstock/marketData';
import type { RouteHandlerOptions } from '../handlerKit';
import { authHandlers, type AuthMockOptions } from './auth';
import { marketHandlers } from './market';
import { quoteStreamHandler, type QuoteStreamOptions } from './quoteStream';

export type MockHandlersOptions = {
  adapter: MarketDataAdapter;
  /** WebSocket URL the quote stream intercepts. */
  wsUrl: string;
  rest?: RouteHandlerOptions;
  stream?: Omit<QuoteStreamOptions, 'url'>;
  auth?: AuthMockOptions;
};

/** Every MSW handler the app uses, REST and WebSocket, over one adapter. */
export function createHandlers({ adapter, wsUrl, rest, stream, auth }: MockHandlersOptions) {
  return [
    ...marketHandlers(adapter, rest),
    ...authHandlers(rest, auth),
    quoteStreamHandler(adapter, { ...stream, url: wsUrl }),
  ];
}

export { marketHandlers, MOCK_VERSION } from './market';
export { authHandlers, createAuthMock, MSW_SESSION_COOKIE, type AuthMockOptions } from './auth';
export { QUOTE_FLUSH_MS, quoteStreamHandler, type QuoteStreamOptions } from './quoteStream';
