import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';

describe('public entry point', () => {
  it('re-exports every module', () => {
    for (const name of [
      'Paise',
      'TradingSymbol',
      'ApiError',
      'cursorPage',
      'Quote',
      'Mobile',
      'Watchlist',
      'WATCHLIST_MAX_ITEMS',
      'PlaceOrderRequest',
      'TrailingStop',
      'TrailingStopParams',
      'AccountState',
      'FundsSummary',
      'WsServerMessage',
      'TickBatch',
      'encodeQuoteFrame',
      'routes',
      'TEST_CONTROL_PATHS',
    ]) {
      expect(contracts, name).toHaveProperty(name);
    }
  });
});
