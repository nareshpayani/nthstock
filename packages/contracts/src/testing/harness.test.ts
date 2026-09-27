import { describe, expect, it, vi } from 'vitest';
import {
  PRE_SESSION_CSRF,
  ScenarioError,
  createScenarioClient,
  defineScenarios,
  runScenarioSuite,
  toQueryString,
  type BackendRequest,
  type BackendResponse,
  type ScenarioBackend,
} from './harness.js';
import { fetchBackend, type FetchLike } from './fetchBackend.js';
import { healthScenarios } from './scenarios/health.js';

const HEALTH = { status: 'ok', version: 'test', time: '2026-09-25T04:00:00.000Z' };

/** A backend answering from a function, recording what it was sent. */
function fakeBackend(answer: (request: BackendRequest) => BackendResponse) {
  const sent: BackendRequest[] = [];
  const close = vi.fn();
  const backend: ScenarioBackend = {
    send: (request) => {
      sent.push(request);
      return Promise.resolve(answer(request));
    },
    close,
  };
  return { backend, sent, close };
}

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Symbol NOPE not found' } };

describe('toQueryString', () => {
  it('encodes values and drops undefined ones', () => {
    expect(toQueryString({ q: 'm&m', limit: 5, flag: true, skip: undefined })).toBe(
      '?q=m%26m&limit=5&flag=true',
    );
    expect(toQueryString({})).toBe('');
    expect(toQueryString()).toBe('');
  });
});

describe('createScenarioClient', () => {
  it('builds the request from the route map and parses the response', async () => {
    const { backend, sent } = fakeBackend(() => ({
      status: 200,
      body: { items: [], extra: 'dropped' },
    }));
    const client = createScenarioClient(backend);

    const result = await client.call('marketSearch', { query: { q: 'infy', limit: 3 } });

    expect(result).toEqual({ items: [] });
    expect(sent).toEqual([{ method: 'GET', url: '/v1/market/search?q=infy&limit=3' }]);
  });

  it('sends path params and a JSON body', async () => {
    const { backend, sent } = fakeBackend(() => ({
      status: 200,
      body: { requestId: 'r1', resendAfterSec: 30, expiresAt: HEALTH.time },
    }));
    const client = createScenarioClient(backend);

    await client.call('otpRequest', { body: { mobile: '9876543210' } });
    await client.callError('instrument', { params: { symbol: 'M&M' } }).catch(() => undefined);

    expect(sent[0]).toEqual({
      method: 'POST',
      url: '/v1/auth/otp/request',
      body: { mobile: '9876543210' },
      headers: { 'x-csrf-token': PRE_SESSION_CSRF },
    });
    expect(sent[1]?.url).toBe('/v1/market/instruments/M%26M');
  });

  it('fails a call on a non-2xx status', async () => {
    const client = createScenarioClient(
      fakeBackend(() => ({ status: 404, body: NOT_FOUND })).backend,
    );

    await expect(client.call('health')).rejects.toThrow(ScenarioError);
    await expect(client.call('health')).rejects.toThrow(/health failed: HTTP 404/);
  });

  it('fails a call whose body breaks the response schema', async () => {
    const client = createScenarioClient(
      fakeBackend(() => ({ status: 200, body: { status: 'ok' } })).backend,
    );

    await expect(client.call('health')).rejects.toThrow(/broke its response schema/);
  });

  it('parses an expected error as ApiError', async () => {
    const client = createScenarioClient(
      fakeBackend(() => ({ status: 404, body: NOT_FOUND })).backend,
    );

    const result = await client.callError('instrument', { params: { symbol: 'NOPE' } });

    expect(result).toEqual({ status: 404, body: NOT_FOUND });
  });

  it('fails callError on success or on a body that is not an ApiError', async () => {
    const ok = createScenarioClient(fakeBackend(() => ({ status: 200, body: HEALTH })).backend);
    await expect(ok.callError('health')).rejects.toThrow(/expected to fail/);

    const odd = createScenarioClient(fakeBackend(() => ({ status: 500, body: 'oops' })).backend);
    await expect(odd.callError('health')).rejects.toThrow(/not an ApiError/);
  });

  it('passes raw requests straight through', async () => {
    const { backend } = fakeBackend((request) => ({ status: 418, body: request.url }));
    const client = createScenarioClient(backend);

    expect(await client.send({ method: 'GET', url: '/v1/teapot' })).toEqual({
      status: 418,
      body: '/v1/teapot',
    });
  });
});

describe('createScenarioClient: cookies, CSRF and time', () => {
  const SESSION = {
    user: {
      id: 'usr_1',
      mobileMasked: '******3210',
      name: null,
      email: null,
      kycStatus: 'NOT_STARTED',
      pinSet: false,
      totpEnabled: false,
      createdAt: HEALTH.time,
    },
    device: {
      id: 'dev_1',
      label: 'Chrome on macOS',
      trusted: false,
      current: true,
      createdAt: HEALTH.time,
      lastSeenAt: HEALTH.time,
    },
    accessToken: 'at',
    accessTokenExpiresAt: HEALTH.time,
    csrfToken: 'session-csrf-token-123',
  };

  it('keeps Set-Cookie cookies and the session CSRF token, and drops the token on logout', async () => {
    const { backend, sent } = fakeBackend((request) =>
      request.url === '/v1/auth/logout'
        ? { status: 200, body: { ok: true }, setCookies: ['sid=; Max-Age=0'] }
        : { status: 200, body: SESSION, setCookies: ['sid=abc; Path=/; HttpOnly'] },
    );
    const client = createScenarioClient(backend);

    await client.call('sessionRefresh');
    await client.call('sessionGet');
    await client.call('logout');
    await client.call('sessionRefresh', { csrf: false });
    await client.call('sessionRefresh', { csrf: 'given' });

    expect(sent.map((r) => r.headers)).toEqual([
      { 'x-csrf-token': PRE_SESSION_CSRF },
      { cookie: 'sid=abc' },
      { cookie: 'sid=abc', 'x-csrf-token': 'session-csrf-token-123' },
      { cookie: 'sid=' },
      { cookie: 'sid=abc', 'x-csrf-token': 'given' },
    ]);
    expect(client.csrfToken()).toBe(SESSION.csrfToken);
    expect(client.cookies.get('sid')).toBe('abc');
  });

  it('moves the backend clock, or says it cannot', async () => {
    const advance = vi.fn();
    const withClock = createScenarioClient({
      ...fakeBackend(() => ({ status: 200, body: HEALTH })).backend,
      advanceTime: advance,
    });
    await withClock.advanceTime(30_000);
    expect(advance).toHaveBeenCalledWith(30_000);

    const without = createScenarioClient(
      fakeBackend(() => ({ status: 200, body: HEALTH })).backend,
    );
    await expect(without.advanceTime(1)).rejects.toThrow(/cannot move its clock/);
  });

  it('sets the backend clock and scripts prices, or says it cannot', async () => {
    const setTime = vi.fn();
    const setPrice = vi.fn();
    const withControls = createScenarioClient({
      ...fakeBackend(() => ({ status: 200, body: HEALTH })).backend,
      setTime,
      setPrice,
    });
    await withControls.setTime('2026-09-28T04:30:00.000Z');
    await withControls.setPrice(1594, 150_000);
    expect(setTime).toHaveBeenCalledWith('2026-09-28T04:30:00.000Z');
    expect(setPrice).toHaveBeenCalledWith(1594, 150_000);

    const without = createScenarioClient(
      fakeBackend(() => ({ status: 200, body: HEALTH })).backend,
    );
    await expect(without.setTime('2026-09-28T04:30:00.000Z')).rejects.toThrow(/set its clock/);
    await expect(without.setPrice(1, 5)).rejects.toThrow(/script prices/);
  });
});

describe('runScenarioSuite scopes', () => {
  const scopes: number[] = [];
  const base = fakeBackend(() => ({ status: 200, body: HEALTH })).backend;
  runScenarioSuite(
    'a scoped fake backend',
    [
      defineScenarios('scopes', [
        { name: 'first', run: async (client) => void (await client.call('health')) },
        { name: 'second', run: async (client) => void (await client.call('health')) },
      ]),
    ],
    () => ({
      ...base,
      scope: (index) => {
        scopes.push(index);
        return base;
      },
    }),
  );

  it('gave each scenario its own scope', () => {
    expect(scopes).toEqual([1, 2]);
  });
});

describe('fetchBackend', () => {
  const fakeFetch = (status: number, text: string) =>
    vi.fn<FetchLike>(() => Promise.resolve({ status, text: () => Promise.resolve(text) }));

  it('sends GETs without a body and parses JSON', async () => {
    const fetch = fakeFetch(200, JSON.stringify(HEALTH));
    const backend = fetchBackend('http://api.test', fetch);

    const response = await backend.send({ method: 'GET', url: '/v1/health' });

    expect(response).toEqual({ status: 200, body: HEALTH });
    expect(fetch).toHaveBeenCalledWith('http://api.test/v1/health', {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    expect(backend.close).toBeUndefined();
  });

  it('sends JSON bodies and maps an empty response to null', async () => {
    const fetch = fakeFetch(204, '');
    const onClose = vi.fn();
    const backend = fetchBackend('http://api.test', fetch, onClose);

    const response = await backend.send({ method: 'POST', url: '/v1/x', body: { a: 1 } });
    await backend.close?.();

    expect(response).toEqual({ status: 204, body: null });
    expect(fetch.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('fetchBackend: cookies, scopes and time', () => {
  it('sends extra headers, reads Set-Cookie lines, scopes the origin and moves the clock', async () => {
    const fetch = vi.fn<FetchLike>(() =>
      Promise.resolve({
        status: 200,
        text: () => Promise.resolve('{}'),
        headers: { getSetCookie: () => ['a=1; Path=/'] },
      }),
    );
    const advanceTime = vi.fn();
    const setTime = vi.fn();
    const setPrice = vi.fn();
    const backend = fetchBackend('http://api.test', fetch, {
      scopeOrigin: (index) => `http://s${String(index)}.api.test`,
      advanceTime,
      setTime,
      setPrice,
    });

    const response = await backend.scope?.(2)?.send({
      method: 'GET',
      url: '/v1/x',
      headers: { cookie: 'a=0' },
    });
    await backend.advanceTime?.(10);
    await backend.scope?.(3).setTime?.('2026-09-28T04:30:00.000Z');
    await backend.setPrice?.(7, 100);

    expect(response).toEqual({ status: 200, body: {}, setCookies: ['a=1; Path=/'] });
    expect(fetch).toHaveBeenCalledWith('http://s2.api.test/v1/x', {
      method: 'GET',
      headers: { accept: 'application/json', cookie: 'a=0' },
    });
    expect(advanceTime).toHaveBeenCalledWith(10);
    expect(setTime).toHaveBeenCalledWith('2026-09-28T04:30:00.000Z');
    expect(setPrice).toHaveBeenCalledWith(7, 100);
    expect(backend.close).toBeUndefined();
  });
});

// The harness itself: the shared health scenarios against an in-memory backend.
const fake = fakeBackend((request) =>
  request.url === '/v1/health' ? { status: 200, body: HEALTH } : { status: 404, body: NOT_FOUND },
);
runScenarioSuite('a fake backend', [healthScenarios], () => fake.backend);
