import type { SearchHit } from '@nthstock/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_MAX,
  addRecentSearch,
  readRecentSearches,
} from './recentSearches';

const hit = (symbol: string, exchange: 'NSE' | 'BSE' = 'NSE'): SearchHit => ({
  token: symbol.length + (exchange === 'BSE' ? 1000 : 0),
  symbol,
  exchange,
  name: `${symbol} Ltd`,
  type: 'EQUITY',
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('recent searches', () => {
  it('starts empty and keeps the newest first, without duplicates', () => {
    expect(readRecentSearches()).toEqual([]);
    addRecentSearch(hit('INFY'));
    addRecentSearch(hit('TCS'));
    expect(addRecentSearch(hit('INFY')).map((h) => h.symbol)).toEqual(['INFY', 'TCS']);
    expect(readRecentSearches().map((h) => h.symbol)).toEqual(['INFY', 'TCS']);
  });

  it('keeps the same symbol on another exchange as a separate entry', () => {
    addRecentSearch(hit('SENSEX', 'BSE'));
    expect(addRecentSearch(hit('SENSEX')).map((h) => h.exchange)).toEqual(['NSE', 'BSE']);
  });

  it(`keeps at most ${String(RECENT_SEARCHES_MAX)}`, () => {
    for (const symbol of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) addRecentSearch(hit(symbol));
    expect(readRecentSearches().map((h) => h.symbol)).toEqual(['G', 'F', 'E', 'D', 'C']);
  });

  it('reads corrupt or foreign data as empty', () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, '{not json');
    expect(readRecentSearches()).toEqual([]);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([{ symbol: 'infy' }]));
    expect(readRecentSearches()).toEqual([]);
  });

  it('works without storage: reads nothing and does not throw on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecentSearches()).toEqual([]);
    expect(addRecentSearch(hit('INFY')).map((h) => h.symbol)).toEqual(['INFY']);
  });
});
