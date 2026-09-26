import { createQuoteStore, quoteKey, type QuoteSource } from '@nthstock/apiClient';
import type { Exchange, Quote } from '@nthstock/contracts';

/** A schema-shaped quote for tests. `ltp` in paise (or hundredths for indices). */
export function testQuote(symbol: string, ltp: number, overrides: Partial<Quote> = {}): Quote {
  const prevClose = overrides.prevClose ?? ltp;
  const change = ltp - prevClose;
  return {
    token: 100 + symbol.length,
    symbol,
    exchange: 'NSE',
    ltp,
    change,
    changeBp: prevClose === 0 ? 0 : Math.round((change * 10_000) / prevClose),
    open: prevClose,
    high: Math.max(prevClose, ltp),
    low: Math.min(prevClose, ltp),
    prevClose,
    volume: 1_000,
    ts: '2026-09-25T04:00:00.000Z',
    ...overrides,
  };
}

/**
 * A quote store driven by hand: `frame()` runs the pending animation-frame flush, and `source`
 * records which symbols are subscribed (ref counts by `EXCHANGE:SYMBOL`).
 */
export function createTestQuoteStore() {
  const frames: (() => void)[] = [];
  const subscribed = new Map<string, number>();
  const source: QuoteSource = {
    subscribe(symbol: string, exchange: Exchange) {
      const key = quoteKey(symbol, exchange);
      subscribed.set(key, (subscribed.get(key) ?? 0) + 1);
      return () => subscribed.set(key, (subscribed.get(key) ?? 0) - 1);
    },
    onQuotes: () => () => undefined,
  };
  const store = createQuoteStore({ source, schedule: (flush) => frames.push(flush) });
  return {
    store,
    subscribed,
    /** Queues quotes and runs one frame. */
    push(...quotes: Quote[]) {
      store.ingest(quotes);
      for (const flush of frames.splice(0)) flush();
    },
    ingest: (...quotes: Quote[]) => store.ingest(quotes),
    frame: () => {
      for (const flush of frames.splice(0)) flush();
    },
  };
}
