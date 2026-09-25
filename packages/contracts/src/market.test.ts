import { describe, expect, it } from 'vitest';
import {
  candleSeriesFixture,
  depthFixture,
  indexInstrumentFixture,
  indexSummaryFixture,
  instrumentFixture,
  moversFixture,
  quoteFixture,
  quoteRowFixture,
  searchResponseFixture,
  statsFixture,
  stockListFixture,
} from './fixtures.js';
import {
  BatchQuotesQuery,
  BatchQuotesResponse,
  Candle,
  CandleRange,
  CandleSeries,
  CandlesQuery,
  Depth,
  IndexSummary,
  IndicesResponse,
  Instrument,
  InstrumentStats,
  Movers,
  MoversQuery,
  Quote,
  QuoteRow,
  SearchQuery,
  SearchResponse,
  StockList,
  StockListsResponse,
} from './market.js';

describe('market fixtures round-trip', () => {
  it.each([
    ['Instrument', Instrument, instrumentFixture],
    ['Instrument (index)', Instrument, indexInstrumentFixture],
    ['SearchResponse', SearchResponse, searchResponseFixture],
    ['Quote', Quote, quoteFixture],
    ['BatchQuotesResponse', BatchQuotesResponse, { items: [quoteFixture] }],
    ['InstrumentStats', InstrumentStats, statsFixture],
    ['CandleSeries', CandleSeries, candleSeriesFixture],
    ['Depth', Depth, depthFixture],
    ['IndexSummary', IndexSummary, indexSummaryFixture],
    ['IndicesResponse', IndicesResponse, { items: [indexSummaryFixture] }],
    ['QuoteRow', QuoteRow, quoteRowFixture],
    ['StockList', StockList, stockListFixture],
    ['StockListsResponse', StockListsResponse, { items: [stockListFixture] }],
    ['Movers', Movers, moversFixture],
  ] as const)('%s', (_name, schema, fixture) => {
    const parsed: unknown = schema.parse(fixture);
    expect(parsed).toEqual(fixture);
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(fixture);
  });
});

describe('market rules', () => {
  it('rejects a quote with float paise or a lowercase symbol', () => {
    expect(Quote.safeParse({ ...quoteFixture, ltp: 1523.45 }).success).toBe(false);
    expect(Quote.safeParse({ ...quoteFixture, symbol: 'infy' }).success).toBe(false);
  });

  it('requires the numeric instrument token', () => {
    expect(Instrument.safeParse({ ...instrumentFixture, token: '408065' }).success).toBe(false);
  });

  it('has the five chart ranges', () => {
    expect(CandleRange.options).toEqual(['1D', '1W', '1M', '1Y', '5Y']);
    expect(CandlesQuery.safeParse({ range: '3M' }).success).toBe(false);
  });

  it('rejects a candle whose high is below its close', () => {
    expect(
      Candle.safeParse({ t: quoteFixture.ts, o: 100, h: 105, l: 95, c: 110, v: 1 }).success,
    ).toBe(false);
    expect(
      Candle.safeParse({ t: quoteFixture.ts, o: 100, h: 105, l: 101, c: 104, v: 1 }).success,
    ).toBe(false);
  });

  it('requires exactly 5 bid and 5 ask levels', () => {
    expect(Depth.safeParse({ ...depthFixture, bids: depthFixture.bids.slice(0, 4) }).success).toBe(
      false,
    );
    expect(
      Depth.safeParse({ ...depthFixture, asks: [...depthFixture.asks, depthFixture.asks[0]] })
        .success,
    ).toBe(false);
  });

  it('splits and validates batch quote symbols', () => {
    expect(BatchQuotesQuery.parse({ symbols: 'INFY, TCS,M&M' })).toEqual({
      symbols: ['INFY', 'TCS', 'M&M'],
    });
    expect(BatchQuotesQuery.safeParse({ symbols: 'infy' }).success).toBe(false);
    expect(BatchQuotesQuery.safeParse({ symbols: '' }).success).toBe(false);
    const tooMany = Array.from({ length: 51 }, (_, i) => `S${i}`).join(',');
    expect(BatchQuotesQuery.safeParse({ symbols: tooMany }).success).toBe(false);
  });

  it('rejects an empty search query and coerces the limit', () => {
    expect(SearchQuery.safeParse({ q: '   ' }).success).toBe(false);
    expect(SearchQuery.parse({ q: ' infy ', limit: '10' })).toEqual({ q: 'infy', limit: 10 });
  });

  it('accepts only gainers or losers for movers', () => {
    expect(MoversQuery.parse({ index: 'NIFTY50', direction: 'gainers' })).toEqual({
      index: 'NIFTY50',
      direction: 'gainers',
    });
    expect(MoversQuery.safeParse({ index: 'NIFTY50', direction: 'up' }).success).toBe(false);
  });

  it('rejects a stock list with a non-slug id', () => {
    expect(StockList.safeParse({ ...stockListFixture, id: 'Top IT' }).success).toBe(false);
  });
});
