import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { useDayDirection, useQuote } from './useQuote';

describe('useQuote', () => {
  it('returns undefined without a provider (detached store) and never throws', () => {
    const { result } = renderHook(() => useQuote('INFY'));
    expect(result.current).toBeUndefined();
  });

  it('follows the symbol: switching unsubscribes the old one and subscribes the new one', () => {
    const quotes = createTestQuoteStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QuoteStoreContext.Provider value={quotes.store}>{children}</QuoteStoreContext.Provider>
    );
    const { result, rerender } = renderHook(({ symbol }) => useQuote(symbol), {
      wrapper,
      initialProps: { symbol: 'INFY' },
    });
    act(() => quotes.push(testQuote('INFY', 150000), testQuote('TCS', 400000)));
    expect(result.current?.quote.ltp).toBe(150000);
    rerender({ symbol: 'TCS' });
    expect(result.current?.quote.ltp).toBe(400000);
    expect(quotes.subscribed.get('NSE:INFY')).toBe(0);
    expect(quotes.subscribed.get('NSE:TCS')).toBe(1);
  });
});

describe('useDayDirection', () => {
  it("follows the day's change, not the last tick, and skips renders while it holds", () => {
    const quotes = createTestQuoteStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QuoteStoreContext.Provider value={quotes.store}>{children}</QuoteStoreContext.Provider>
    );
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useDayDirection('INFY');
      },
      { wrapper },
    );
    expect(result.current).toBeUndefined();
    act(() => quotes.push(testQuote('INFY', 150000, { prevClose: 151000 })));
    expect(result.current).toBe('down');
    const before = renders;
    // An uptick that leaves the day still down: same direction, no re-render.
    act(() => quotes.push(testQuote('INFY', 150500, { prevClose: 151000 })));
    expect(result.current).toBe('down');
    expect(renders).toBe(before);
    act(() => quotes.push(testQuote('INFY', 152000, { prevClose: 151000 })));
    expect(result.current).toBe('up');
  });
});
