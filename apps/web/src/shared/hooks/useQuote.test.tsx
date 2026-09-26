import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { useQuote } from './useQuote';

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
