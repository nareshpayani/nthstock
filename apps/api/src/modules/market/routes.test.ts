import {
  ApiError,
  BATCH_QUOTES_MAX,
  BatchQuotesResponse,
  CandleSeries,
  Depth,
  IndicesResponse,
  Instrument,
  InstrumentStats,
  Movers,
  SearchResponse,
  StockList,
  StockListsResponse,
} from '@nthstock/contracts';
import { MockMarketDataAdapter } from '@nthstock/marketData';
import { fixedClock } from '@nthstock/utils';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

// Friday 25 Sep 2026, 11:30 IST: market open. One adapter for the file keeps tests fast.
const clock = fixedClock('2026-09-25T06:00:00.000Z');
const market = new MockMarketDataAdapter({ clock });
const app = buildApp({ deps: { clock, market } });

afterAll(async () => {
  await app.close();
  market.dispose();
});

const get = async (url: string) => {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() as unknown };
};

describe('GET /v1/market/indices', () => {
  it('returns schema-valid index cards', async () => {
    const { status, body } = await get('/v1/market/indices');

    expect(status).toBe(200);
    const symbols = IndicesResponse.parse(body).items.map((i) => i.symbol);
    expect(symbols).toEqual(expect.arrayContaining(['NIFTY50', 'SENSEX']));
  });
});

describe('GET /v1/market/lists', () => {
  it('returns every curated list', async () => {
    const { status, body } = await get('/v1/market/lists');

    expect(status).toBe(200);
    const ids = StockListsResponse.parse(body).items.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['market-giants', 'top-it']));
  });

  it('returns one list by id', async () => {
    const { status, body } = await get('/v1/market/lists/top-it');

    expect(status).toBe(200);
    const list = StockList.parse(body);
    expect(list.id).toBe('top-it');
    expect(list.items.length).toBeGreaterThan(0);
  });

  it('answers 404 for an unknown list', async () => {
    const { status, body } = await get('/v1/market/lists/no-such-list');

    expect(status).toBe(404);
    expect(ApiError.parse(body).error).toEqual({
      code: 'NOT_FOUND',
      message: 'List no-such-list not found',
    });
  });
});

describe('GET /v1/market/movers', () => {
  it('ranks gainers and losers within the limit', async () => {
    const gainers = Movers.parse(
      (await get('/v1/market/movers?index=NIFTY50&direction=gainers&limit=5')).body,
    );
    const losers = Movers.parse(
      (await get('/v1/market/movers?index=NIFTY50&direction=losers&limit=5')).body,
    );

    expect(gainers).toMatchObject({ index: 'NIFTY50', direction: 'gainers' });
    expect(gainers.items.length).toBeLessThanOrEqual(5);
    expect(gainers.items.every((row) => row.change > 0)).toBe(true);
    expect(losers.items.every((row) => row.change < 0)).toBe(true);
  });

  it('answers 404 for an unknown index and 400 for a bad direction', async () => {
    const unknown = await get('/v1/market/movers?index=NOPE&direction=gainers');
    expect(unknown.status).toBe(404);
    expect(ApiError.parse(unknown.body).error.message).toBe('Index NOPE not found');

    const bad = await get('/v1/market/movers?index=NIFTY50&direction=sideways');
    expect(bad.status).toBe(400);
    expect(ApiError.parse(bad.body).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /v1/market/quotes', () => {
  it('returns quotes in request order and skips unknown symbols', async () => {
    const { status, body } = await get('/v1/market/quotes?symbols=TCS,NOPE,INFY');

    expect(status).toBe(200);
    const quotes = BatchQuotesResponse.parse(body).items;
    expect(quotes.map((q) => q.symbol)).toEqual(['TCS', 'INFY']);
    expect(quotes.every((q) => Number.isInteger(q.ltp) && q.ltp % 5 === 0)).toBe(true);
  });

  it('answers 400 without symbols or with too many', async () => {
    expect((await get('/v1/market/quotes')).status).toBe(400);
    const tooMany = Array.from({ length: BATCH_QUOTES_MAX + 1 }, () => 'INFY').join(',');
    expect((await get(`/v1/market/quotes?symbols=${tooMany}`)).status).toBe(400);
  });
});

describe('market adapter lifetime', () => {
  it('disposes the adapter the app built when the app closes', async () => {
    const own = buildApp({ deps: { clock } });
    const adapter = own.deps.market as MockMarketDataAdapter;
    expect(adapter).toBeInstanceOf(MockMarketDataAdapter);
    let ticked = 0;
    own.deps.market.subscribe(['INFY'], () => (ticked += 1));

    await own.close();

    expect(adapter.tick()).toBe(false);
    expect(ticked).toBe(0);
  });

  it('leaves an injected adapter running', async () => {
    const shared = new MockMarketDataAdapter({ clock });
    const other = buildApp({ deps: { clock, market: shared } });

    await other.close();

    expect(shared.tick()).toBe(true);
    shared.dispose();
  });
});

describe('GET /v1/market/search', () => {
  it('ranks an exact symbol first and honours the limit', async () => {
    const { status, body } = await get('/v1/market/search?q=infy&limit=3');

    expect(status).toBe(200);
    const hits = SearchResponse.parse(body).items;
    expect(hits[0]?.symbol).toBe('INFY');
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it('answers 400 for an empty or blank query', async () => {
    for (const url of ['/v1/market/search?q=', '/v1/market/search?q=%20%20', '/v1/market/search']) {
      const { status, body } = await get(url);
      expect(status).toBe(400);
      expect(ApiError.parse(body).error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid query',
      });
    }
  });
});

describe('GET /v1/market/instruments/:symbol', () => {
  it('returns an equity and an index', async () => {
    const infy = Instrument.parse((await get('/v1/market/instruments/INFY')).body);
    expect(infy).toMatchObject({ symbol: 'INFY', type: 'EQUITY', exchange: 'NSE' });

    const nifty = Instrument.parse((await get('/v1/market/instruments/NIFTY50')).body);
    expect(nifty).toMatchObject({ type: 'INDEX', isin: null });
  });

  it('answers 404 for an unknown symbol or the wrong exchange, 400 for a bad symbol', async () => {
    const unknown = await get('/v1/market/instruments/NOPE');
    expect(unknown.status).toBe(404);
    expect(ApiError.parse(unknown.body).error.message).toBe('Symbol NOPE not found');

    expect((await get('/v1/market/instruments/INFY?exchange=BSE')).status).toBe(404);
    expect((await get('/v1/market/instruments/infy')).status).toBe(400);
    expect((await get('/v1/market/instruments/INFY?exchange=LSE')).status).toBe(400);
  });
});

describe('GET /v1/market/instruments/:symbol/candles', () => {
  it.each(['1D', '1W', '1M', '1Y', '5Y'] as const)(
    'returns %s candles ending at the LTP',
    async (range) => {
      const { status, body } = await get(`/v1/market/instruments/INFY/candles?range=${range}`);

      expect(status).toBe(200);
      const series = CandleSeries.parse(body);
      expect(series).toMatchObject({ symbol: 'INFY', range });
      const quote = await market.getQuote('INFY');
      expect(series.candles.at(-1)?.c).toBe(quote?.ltp);
    },
  );

  it('answers 400 for a missing or invalid range and 404 for an unknown symbol', async () => {
    for (const url of [
      '/v1/market/instruments/INFY/candles',
      '/v1/market/instruments/INFY/candles?range=2D',
    ]) {
      const { status, body } = await get(url);
      expect(status).toBe(400);
      expect(ApiError.parse(body).error.code).toBe('VALIDATION_ERROR');
    }
    expect((await get('/v1/market/instruments/NOPE/candles?range=1D')).status).toBe(404);
  });
});

describe('GET /v1/market/instruments/:symbol/depth', () => {
  it('returns top-5 depth for an equity', async () => {
    const { status, body } = await get('/v1/market/instruments/INFY/depth');

    expect(status).toBe(200);
    const depth = Depth.parse(body);
    expect(depth.symbol).toBe('INFY');
    expect(depth.bids[0]?.price ?? 0).toBeLessThan(depth.asks[0]?.price ?? 0);
  });

  it('answers 404 for an index and an unknown symbol', async () => {
    const index = await get('/v1/market/instruments/NIFTY50/depth');
    expect(index.status).toBe(404);
    expect(ApiError.parse(index.body).error.message).toBe('Depth for NIFTY50 not found');
    expect((await get('/v1/market/instruments/NOPE/depth')).status).toBe(404);
  });
});

describe('GET /v1/market/instruments/:symbol/stats', () => {
  it('returns key stats in paise for an equity', async () => {
    const { status, body } = await get('/v1/market/instruments/TCS/stats');

    expect(status).toBe(200);
    const stats = InstrumentStats.parse(body);
    expect(stats.symbol).toBe('TCS');
    expect(stats.week52Low).toBeLessThanOrEqual(stats.week52High);
    expect(stats.lowerCircuit).toBeLessThan(stats.upperCircuit);
  });

  it('answers 404 for an index', async () => {
    const { status, body } = await get('/v1/market/instruments/SENSEX/stats');
    expect(status).toBe(404);
    expect(ApiError.parse(body).error.message).toBe('Stats for SENSEX not found');
  });
});
