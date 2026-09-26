// @vitest-environment node
import { ApiError, createApiClient } from '@nthstock/apiClient';
import { routes, type RouteName } from '@nthstock/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_API_ORIGIN, createMockServer } from '../node';

const { server, adapter } = createMockServer();
// The client Zod-parses every response against the route's schema, so a resolved call is a
// schema-valid body; the explicit safeParse below keeps that visible.
const client = createApiClient({ baseUrl: TEST_API_ORIGIN });
const covered = new Set<RouteName>();

async function valid<N extends RouteName>(name: N, call: Promise<unknown>) {
  const body = await call;
  expect(routes[name].response.safeParse(body).success).toBe(true);
  covered.add(name);
  return body;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

describe('MSW market handlers (T-052) through the API client (T-053)', () => {
  it('health', async () => {
    await valid('health', client.request('health'));
  });

  it('indices, lists and one list', async () => {
    const indices = await client.request('marketIndices');
    await valid('marketIndices', Promise.resolve(indices));
    expect(indices.items.map((i) => i.symbol)).toContain('NIFTY50');
    const lists = await valid('marketLists', client.request('marketLists'));
    const first = (lists as { items: { id: string }[] }).items[0];
    expect(first).toBeDefined();
    await valid('marketList', client.request('marketList', { params: { id: first?.id ?? '' } }));
  });

  it('movers for an index', async () => {
    const movers = await client.request('marketMovers', {
      query: { index: 'NIFTY50', direction: 'gainers', limit: 5 },
    });
    await valid('marketMovers', Promise.resolve(movers));
    expect(movers.items.length).toBeLessThanOrEqual(5);
  });

  it('batch quotes in request order, across exchanges', async () => {
    const quotes = await client.request('marketQuotes', { query: { symbols: 'TCS,INFY' } });
    await valid('marketQuotes', Promise.resolve(quotes));
    expect(quotes.items.map((q) => q.symbol)).toEqual(['TCS', 'INFY']);
    const bse = await client.request('marketQuotes', {
      query: { symbols: 'SENSEX', exchange: 'BSE' },
    });
    expect(bse.items[0]?.exchange).toBe('BSE');
  });

  it('search ranks the exact symbol first', async () => {
    const hits = await client.request('marketSearch', { query: { q: 'infy', limit: 5 } });
    await valid('marketSearch', Promise.resolve(hits));
    expect(hits.items[0]?.symbol).toBe('INFY');
  });

  it('instrument, candles, depth and stats', async () => {
    const params = { symbol: 'INFY' };
    await valid('instrument', client.request('instrument', { params }));
    for (const range of ['1D', '1W', '1M', '1Y', '5Y'] as const) {
      await valid(
        'instrumentCandles',
        client.request('instrumentCandles', { params, query: { range } }),
      );
    }
    await valid('instrumentDepth', client.request('instrumentDepth', { params }));
    await valid('instrumentStats', client.request('instrumentStats', { params }));
  });

  it('covers every market route', () => {
    const marketRoutes = (Object.keys(routes) as RouteName[]).filter(
      (name) => routes[name].path.startsWith('/v1/market') || name === 'health',
    );
    expect([...covered].sort()).toEqual(marketRoutes.sort());
  });
});

describe('errors map to ApiError', () => {
  it.each([
    [
      'unknown symbol',
      () => client.request('instrument', { params: { symbol: 'NOPE' } }),
      404,
      'NOT_FOUND',
    ],
    [
      'wrong exchange',
      () =>
        client.request('instrumentStats', {
          params: { symbol: 'INFY' },
          query: { exchange: 'BSE' },
        }),
      404,
      'NOT_FOUND',
    ],
    [
      'index depth',
      () => client.request('instrumentDepth', { params: { symbol: 'NIFTY50' } }),
      404,
      'NOT_FOUND',
    ],
    [
      'unknown list',
      () => client.request('marketList', { params: { id: 'no-such-list' } }),
      404,
      'NOT_FOUND',
    ],
    [
      'unknown index',
      () => client.request('marketMovers', { query: { index: 'NOPE', direction: 'losers' } }),
      404,
      'NOT_FOUND',
    ],
    [
      'unknown candles',
      () =>
        client.request('instrumentCandles', { params: { symbol: 'NOPE' }, query: { range: '1D' } }),
      404,
      'NOT_FOUND',
    ],
    [
      'empty search',
      () => client.request('marketSearch', { query: { q: '  ' } }),
      400,
      'VALIDATION_ERROR',
    ],
    [
      'bad range',
      () =>
        client.request('instrumentCandles', {
          params: { symbol: 'INFY' },
          query: { range: '2D' as '1D' },
        }),
      400,
      'VALIDATION_ERROR',
    ],
    [
      'lowercase symbol',
      () => client.request('instrument', { params: { symbol: 'infy' } }),
      400,
      'VALIDATION_ERROR',
    ],
  ] as const)('%s → %i %s', async (_label, call, status, code) => {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status, code });
  });
});
