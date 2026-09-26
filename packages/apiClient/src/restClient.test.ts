import type { IndicesResponse } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, codeForStatus, isApiError } from './apiError.js';
import { CSRF_HEADER, createApiClient, trimTrailingSlashes, type FetchLike } from './restClient.js';

const TS = '2026-09-25T04:00:00.000Z';
const indices: IndicesResponse = {
  items: [
    {
      token: 900001,
      symbol: 'NIFTY50',
      name: 'NIFTY 50',
      exchange: 'NSE',
      value: 2541860,
      change: 21245,
      changeBp: 84,
      sparkline: [2520615, 2541860],
      ts: TS,
    },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond(url, init));
  };
  return { fetch, calls };
}

describe('createApiClient', () => {
  it('GETs a route with credentials and returns the parsed body', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, indices));
    const client = createApiClient({ baseUrl: 'http://api.test/', fetch });
    await expect(client.request('marketIndices')).resolves.toEqual(indices);
    expect(calls[0]?.url).toBe('http://api.test/v1/market/indices');
    expect(calls[0]?.init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(calls[0]?.init.headers).not.toHaveProperty(CSRF_HEADER);
  });

  it('fills path params and query, URL-encoding values and skipping undefined', () => {
    const client = createApiClient();
    expect(
      client.url('instrument', { params: { symbol: 'M&M' }, query: { exchange: 'BSE' } }),
    ).toBe('/v1/market/instruments/M%26M?exchange=BSE');
    expect(client.url('instrument', { params: { symbol: 'INFY' } })).toBe(
      '/v1/market/instruments/INFY',
    );
    expect(
      client.url('marketQuotes', { query: { symbols: 'INFY,TCS', exchange: undefined } }),
    ).toBe('/v1/market/quotes?symbols=INFY%2CTCS');
    expect(client.url('fundsLedger', { query: { limit: 20 } })).toBe('/v1/funds/ledger?limit=20');
  });

  it('sends a JSON body and the CSRF header on state-changing requests', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { ok: true }));
    const client = createApiClient({ fetch, csrfToken: () => 'csrf-test-value' });
    await client.request('logout');
    await client.request('watchlistDelete', { params: { id: 'wl_1' } });
    expect(calls[0]?.init.headers).toMatchObject({ [CSRF_HEADER]: 'csrf-test-value' });
    expect(calls[1]?.init.method).toBe('DELETE');

    const withBody = fakeFetch(() => json(400, {}));
    await expect(
      createApiClient({ fetch: withBody.fetch }).request('watchlistCreate', {
        body: { name: 'Tech' },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(withBody.calls[0]?.init.body).toBe('{"name":"Tech"}');
    expect(withBody.calls[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(withBody.calls[0]?.init.headers).not.toHaveProperty(CSRF_HEADER);
  });

  it('maps a 4xx ApiError envelope to ApiError', async () => {
    const { fetch } = fakeFetch(() =>
      json(404, { error: { code: 'NOT_FOUND', message: 'No such symbol', details: { s: 'X' } } }),
    );
    const error = await createApiClient({ fetch })
      .request('instrument', { params: { symbol: 'NOPE' } })
      .catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      kind: 'http',
      status: 404,
      code: 'NOT_FOUND',
      message: 'No such symbol',
      details: { s: 'X' },
    });
  });

  it('falls back to a code from the status when the body is not an envelope', async () => {
    const { fetch } = fakeFetch(() => new Response('Too many', { status: 429 }));
    await expect(createApiClient({ fetch }).request('health')).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      code: 'RATE_LIMITED',
    });
    const empty = fakeFetch(() => new Response(null, { status: 502, statusText: 'Bad Gateway' }));
    await expect(createApiClient({ fetch: empty.fetch }).request('health')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Bad Gateway',
    });
  });

  it('rejects a 2xx body that breaks the contract', async () => {
    const { fetch } = fakeFetch(() => json(200, { items: [{ symbol: 'nifty' }] }));
    await expect(createApiClient({ fetch }).request('marketIndices')).rejects.toMatchObject({
      kind: 'contract',
      code: 'INTERNAL_ERROR',
    });
  });

  it('wraps network failures but lets aborts through', async () => {
    const down: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    await expect(createApiClient({ fetch: down }).request('health')).rejects.toMatchObject({
      kind: 'network',
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
      message: 'fetch failed',
    });
    const odd: FetchLike = () => Promise.reject('boom' as unknown as Error);
    await expect(createApiClient({ fetch: odd }).request('health')).rejects.toMatchObject({
      message: 'Network request failed',
    });

    const controller = new AbortController();
    const aborting: FetchLike = (_url, init) => {
      expect(init.signal).toBe(controller.signal);
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    };
    controller.abort();
    await expect(
      createApiClient({ fetch: aborting }).request('health', { signal: controller.signal }),
    ).rejects.toHaveProperty('name', 'AbortError');
  });

  it('uses the global fetch by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, indices));
    await createApiClient({ baseUrl: 'http://x.test' }).request('marketIndices');
    expect(spy).toHaveBeenCalledWith('http://x.test/v1/market/indices', expect.any(Object));
    spy.mockRestore();
  });
});

describe('codeForStatus', () => {
  it.each([
    [400, 'VALIDATION_ERROR'],
    [422, 'VALIDATION_ERROR'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
    [504, 'SERVICE_UNAVAILABLE'],
    [500, 'INTERNAL_ERROR'],
  ] as const)('%i → %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});

describe('trimTrailingSlashes', () => {
  it('drops every trailing slash and nothing else', () => {
    expect(trimTrailingSlashes('https://api.example.test/v1///')).toBe(
      'https://api.example.test/v1',
    );
    expect(trimTrailingSlashes('/api')).toBe('/api');
    expect(trimTrailingSlashes('///')).toBe('');
    expect(trimTrailingSlashes('')).toBe('');
  });

  it('stays fast on a long run of slashes', () => {
    const input = `a${'/'.repeat(100_000)}b${'/'.repeat(100_000)}`;
    const start = performance.now();
    expect(trimTrailingSlashes(input)).toBe(`a${'/'.repeat(100_000)}b`);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
