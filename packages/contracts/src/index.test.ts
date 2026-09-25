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
      'FundsSummary',
      'WsServerMessage',
      'routes',
    ]) {
      expect(contracts, name).toHaveProperty(name);
    }
  });
});
