import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore } from '@/test/quotes';
import { useKeepLive } from './useKeepLive';

describe('useKeepLive', () => {
  it('keeps its symbols subscribed while the store is paused, until unmount or change', () => {
    const quotes = createTestQuoteStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QuoteStoreContext.Provider value={quotes.store}>{children}</QuoteStoreContext.Provider>
    );
    for (const symbol of ['INFY', 'TCS', 'WIPRO']) {
      quotes.store.subscribe(symbol, 'NSE', () => undefined);
    }
    const { rerender, unmount } = renderHook(({ symbols }) => useKeepLive(symbols), {
      wrapper,
      initialProps: { symbols: ['INFY', 'TCS'] },
    });
    quotes.store.pause();
    expect(Object.fromEntries(quotes.subscribed)).toEqual({
      'NSE:INFY': 1,
      'NSE:TCS': 1,
      'NSE:WIPRO': 0,
    });
    rerender({ symbols: ['INFY'] });
    expect(quotes.subscribed.get('NSE:TCS')).toBe(0);
    unmount();
    expect(quotes.subscribed.get('NSE:INFY')).toBe(0);
  });
});
