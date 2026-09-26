import type { Exchange, Quote } from '@nthstock/contracts';

const tokens = new Map<string, number>();

/** A valid quote for tests; the token is stable per symbol and exchange. */
export function testQuote(
  symbol: string,
  ltp: number,
  overrides: Partial<Quote> & { exchange?: Exchange } = {},
): Quote {
  const exchange = overrides.exchange ?? 'NSE';
  const key = `${exchange}:${symbol}`;
  let token = tokens.get(key);
  if (token === undefined) {
    token = tokens.size + 1;
    tokens.set(key, token);
  }
  const prevClose = overrides.prevClose ?? 100_000;
  return {
    token,
    symbol,
    exchange,
    ltp,
    change: ltp - prevClose,
    changeBp: Math.round(((ltp - prevClose) * 10_000) / prevClose),
    open: prevClose,
    high: Math.max(ltp, prevClose),
    low: Math.min(ltp, prevClose),
    prevClose,
    volume: 1_000,
    ts: '2026-09-25T05:00:00.000Z',
    ...overrides,
  };
}
