import { MockMarketDataAdapter } from '@nthstock/marketData';

export type MockMarketOptions = {
  /** VITE_MOCK_MARKET_OPEN: tick outside NSE hours, for demos and e2e. */
  alwaysOpen?: boolean;
  /** Milliseconds between simulated ticks (adapter default 1,000). */
  tickIntervalMs?: number;
};

/**
 * The one mock market behind every MSW handler (REST and WebSocket), so a price is the same
 * whichever way the app reads it.
 */
export function createMockMarket(options: MockMarketOptions = {}): MockMarketDataAdapter {
  return new MockMarketDataAdapter({
    alwaysOpen: options.alwaysOpen ?? false,
    ...(options.tickIntervalMs === undefined ? {} : { tickIntervalMs: options.tickIntervalMs }),
  });
}
