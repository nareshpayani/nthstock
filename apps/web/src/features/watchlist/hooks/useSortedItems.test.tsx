import type { Quote, WatchlistItem } from '@nthstock/contracts';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import type { WatchlistSort } from '../model/sortItems';
import { RESORT_MS, useSortedItems } from './useSortedItems';

const item = (token: number, symbol: string): WatchlistItem => ({
  token,
  symbol,
  exchange: 'NSE',
  name: symbol,
  addedAt: '2026-09-25T04:00:00.000Z',
});
const items = [item(1, 'INFY'), item(2, 'TCS'), item(3, 'SBIN')];
const noSnapshot: ReadonlyMap<string, Quote> = new Map();
let ts = 0;
const quote = (symbol: string, changeBp: number) =>
  testQuote(symbol, 100_000 + changeBp * 10, {
    prevClose: 100_000,
    changeBp,
    ts: new Date(Date.UTC(2026, 8, 25, 5, 0, (ts += 1))).toISOString(),
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(sort: WatchlistSort, snapshot = noSnapshot) {
  const quotes = createTestQuoteStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QuoteStoreContext.Provider value={quotes.store}>{children}</QuoteStoreContext.Provider>
  );
  const view = renderHook(
    ({ list, by }: { list: WatchlistItem[]; by: WatchlistSort }) =>
      useSortedItems(list, by, snapshot).map((i) => i.symbol),
    { wrapper, initialProps: { list: items, by: sort } },
  );
  return { ...view, quotes };
}

describe('useSortedItems (T-123)', () => {
  it('re-sorts a price sort every 2 s, not on each tick', () => {
    const { result, quotes, rerender } = setup('custom');
    act(() => {
      quotes.push(quote('INFY', 100), quote('TCS', 300), quote('SBIN', 200));
    });
    expect(result.current).toEqual(['INFY', 'TCS', 'SBIN']);

    // Choosing the sort applies at once.
    rerender({ list: items, by: 'change' });
    expect(result.current).toEqual(['TCS', 'SBIN', 'INFY']);

    // Ticks alone do not move rows…
    act(() => {
      quotes.push(quote('INFY', 900));
    });
    act(() => {
      vi.advanceTimersByTime(RESORT_MS - 1);
    });
    expect(result.current).toEqual(['TCS', 'SBIN', 'INFY']);

    // …the next 2 s beat does.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual(['INFY', 'TCS', 'SBIN']);

    // Custom restores the saved order and stops the beat.
    rerender({ list: items, by: 'custom' });
    expect(result.current).toEqual(['INFY', 'TCS', 'SBIN']);
    act(() => {
      quotes.push(quote('INFY', -900));
      vi.advanceTimersByTime(RESORT_MS * 3);
    });
    expect(result.current).toEqual(['INFY', 'TCS', 'SBIN']);
  });

  it('uses the REST snapshot for rows with no live quote, and sorts a changed list at once', () => {
    const snapshot = new Map([
      ['NSE:INFY', quote('INFY', 50)],
      ['NSE:TCS', quote('TCS', 10)],
    ]);
    const { result, rerender } = setup('ltp', snapshot);
    // SBIN has no price anywhere: it goes last.
    expect(result.current).toEqual(['INFY', 'TCS', 'SBIN']);
    rerender({ list: [item(2, 'TCS'), item(3, 'SBIN')], by: 'ltp' });
    expect(result.current).toEqual(['TCS', 'SBIN']);
  });

  it('sorts by name without a beat', () => {
    const { result } = setup('name');
    expect(result.current).toEqual(['INFY', 'SBIN', 'TCS']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
