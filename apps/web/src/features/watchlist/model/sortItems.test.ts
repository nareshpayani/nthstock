import { describe, expect, it } from 'vitest';
import { isWatchlistSort, moveItem, sortItems, type SortQuote } from './sortItems';

const items = [{ symbol: 'TCS' }, { symbol: 'INFY' }, { symbol: 'WIPRO' }, { symbol: 'HDFCBANK' }];
const quotes: Record<string, SortQuote> = {
  TCS: { ltp: 400_000, changeBp: -120 },
  INFY: { ltp: 180_000, changeBp: 250 },
  WIPRO: { ltp: 50_000, changeBp: 10 },
};
const quoteOf = (item: { symbol: string }) => quotes[item.symbol];
const symbols = (list: { symbol: string }[]) => list.map((item) => item.symbol);

describe('sortItems (T-123)', () => {
  it('keeps the saved order for custom', () => {
    expect(symbols(sortItems(items, 'custom', quoteOf))).toEqual([
      'TCS',
      'INFY',
      'WIPRO',
      'HDFCBANK',
    ]);
  });

  it('sorts by name A to Z', () => {
    expect(symbols(sortItems(items, 'name', quoteOf))).toEqual([
      'HDFCBANK',
      'INFY',
      'TCS',
      'WIPRO',
    ]);
  });

  it('sorts % change and last price high to low, unpriced stocks last', () => {
    expect(symbols(sortItems(items, 'change', quoteOf))).toEqual([
      'INFY',
      'WIPRO',
      'TCS',
      'HDFCBANK',
    ]);
    expect(symbols(sortItems(items, 'ltp', quoteOf))).toEqual(['TCS', 'INFY', 'WIPRO', 'HDFCBANK']);
  });

  it('does not change the input', () => {
    const copy = [...items];
    sortItems(items, 'name', quoteOf);
    expect(items).toEqual(copy);
  });

  it('recognises sort values', () => {
    expect(isWatchlistSort('change')).toBe(true);
    expect(isWatchlistSort('volume')).toBe(false);
    expect(isWatchlistSort(null)).toBe(false);
  });
});

describe('moveItem', () => {
  it('moves an entry and clamps the target', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
  });
});
