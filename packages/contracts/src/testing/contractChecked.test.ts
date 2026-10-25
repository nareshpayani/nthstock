import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { routes, type RouteDef } from '../routes.js';
import {
  ContractViolationError,
  contractChecked,
  contractViolation,
  matchRoute,
} from './contractChecked.js';
import { createScenarioClient, type BackendResponse, type ScenarioBackend } from './harness.js';

const HEALTH = { status: 'ok', version: 'test', time: '2026-09-25T04:00:00.000Z' };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } };

const backendAnswering = (response: BackendResponse): ScenarioBackend => ({
  send: () => Promise.resolve(response),
});

describe('matchRoute', () => {
  it('finds the route by method and path, ignoring the query string', () => {
    expect(matchRoute('GET', '/v1/health')?.name).toBe('health');
    expect(matchRoute('get', '/v1/market/search?q=infy')?.name).toBe('marketSearch');
    expect(matchRoute('GET', '/v1/market/instruments/M%26M/candles')?.name).toBe(
      'instrumentCandles',
    );
    expect(matchRoute('DELETE', '/v1/watchlists/w1/items/42')?.name).toBe('watchlistItemRemove');
  });

  it('prefers a static segment over a param', () => {
    const map: Record<string, RouteDef> = {
      byId: { method: 'PUT', path: '/v1/things/:id', auth: 'user', response: z.unknown() },
      order: { method: 'PUT', path: '/v1/things/order', auth: 'user', response: z.unknown() },
    };
    expect(matchRoute('PUT', '/v1/things/order', map)?.name).toBe('order');
    expect(matchRoute('PUT', '/v1/things/t1', map)?.name).toBe('byId');
  });

  it('returns null for an unknown method or path', () => {
    expect(matchRoute('POST', '/v1/health')).toBeNull();
    expect(matchRoute('GET', '/v1/nope')).toBeNull();
    expect(matchRoute('GET', '/v1/health/ready/extra')).toBeNull();
  });

  it('covers every route in the map', () => {
    for (const [name, def] of Object.entries(routes)) {
      const url = def.path.replace(/:([A-Za-z]+)/g, 'x1');
      expect(matchRoute(def.method, url)?.def, name).toBe(def);
    }
  });
});

describe('contractViolation', () => {
  const get = (url: string) => ({ method: 'GET' as const, url });

  it('accepts a 2xx body that matches the route schema', () => {
    expect(contractViolation(get('/v1/health'), { status: 200, body: HEALTH })).toBeNull();
  });

  it('names the route when a 2xx body breaks its schema', () => {
    const violation = contractViolation(get('/v1/health'), { status: 200, body: { ok: 1 } });
    expect(violation).toMatch(/GET \/v1\/health \(route "health"\) answered 200/);
    expect(violation).toMatch(/breaks its response schema/);
  });

  it('rejects a 2xx from a path the map does not have', () => {
    expect(contractViolation(get('/v1/nope'), { status: 200, body: {} })).toMatch(
      /no route in the map/,
    );
  });

  it('requires an ApiError body on every non-2xx under /v1, unknown paths included', () => {
    expect(contractViolation(get('/v1/nope'), { status: 404, body: NOT_FOUND })).toBeNull();
    expect(contractViolation(get('/v1/health'), { status: 503, body: NOT_FOUND })).toBeNull();
    expect(contractViolation(get('/v1/nope'), { status: 404, body: { message: 'nope' } })).toMatch(
      /GET \/v1\/nope answered 404 without an ApiError body/,
    );
    expect(contractViolation(get('/v1/health'), { status: 500, body: null })).toMatch(
      /route "health".*without an ApiError body/,
    );
  });

  it('skips the test controls and paths outside /v1', () => {
    const bad = { status: 200, body: 'anything' };
    expect(contractViolation({ method: 'POST', url: '/v1/__test/clock' }, bad)).toBeNull();
    expect(contractViolation(get('/assets/app.js'), bad)).toBeNull();
  });
});

describe('contractChecked', () => {
  it('passes good responses through unchanged', async () => {
    const backend = contractChecked(backendAnswering({ status: 200, body: HEALTH }));
    await expect(backend.send({ method: 'GET', url: '/v1/health' })).resolves.toEqual({
      status: 200,
      body: HEALTH,
    });
    expect(backend.violations).toEqual([]);
  });

  it('fails a raw send whose response breaks the contract', async () => {
    const backend = contractChecked(backendAnswering({ status: 404, body: 'Not Found' }));
    const client = createScenarioClient(backend);

    await expect(client.send({ method: 'GET', url: '/v1/nope' })).rejects.toThrow(
      ContractViolationError,
    );
    expect(backend.violations).toHaveLength(1);
  });

  it('checks every scope and fails close with every violation seen', async () => {
    const close = vi.fn();
    const scoped = backendAnswering({ status: 200, body: { wrong: true } });
    const backend = contractChecked({
      ...backendAnswering({ status: 200, body: HEALTH }),
      close,
      scope: () => scoped,
    });

    await backend.send({ method: 'GET', url: '/v1/health' });
    const scope = backend.scope?.(1);
    if (!scope) throw new Error('scope missing');
    await scope.send({ method: 'GET', url: '/v1/health' }).catch(() => undefined);

    await expect(backend.close?.()).rejects.toThrow(
      /1 contract violation\(s\):\n- GET \/v1\/health/,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the clock and price controls of the backend', async () => {
    const advanceTime = vi.fn();
    const backend = contractChecked({
      ...backendAnswering({ status: 200, body: HEALTH }),
      advanceTime,
    });
    await backend.advanceTime?.(5);
    expect(advanceTime).toHaveBeenCalledWith(5);
    await expect(backend.close?.()).resolves.toBeUndefined();
  });

  it('checks against a given route map', async () => {
    const map: Record<string, RouteDef> = {
      extra: {
        method: 'GET',
        path: '/v1/extra',
        auth: 'public',
        response: z.object({ n: z.number() }),
      },
    };
    const backend = contractChecked(backendAnswering({ status: 200, body: { n: 'x' } }), map);
    await expect(backend.send({ method: 'GET', url: '/v1/extra' })).rejects.toThrow(
      /route "extra"/,
    );
  });
});

describe('contractChecked close', () => {
  const broken = (close: () => unknown) =>
    contractChecked({
      send: () => Promise.resolve({ status: 200, body: { wrong: true } }),
      close: close as () => void,
    });

  it('reports violations even when the teardown rejects, with the teardown as cause', async () => {
    const teardown = new Error('teardown');
    const backend = broken(() => Promise.reject(teardown));
    await expect(backend.send({ method: 'GET', url: '/v1/health' })).rejects.toThrow();
    const error: unknown = await Promise.resolve(backend.close?.()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContractViolationError);
    expect((error as Error).cause).toBe(teardown);
  });

  it('reports violations when the teardown throws synchronously', async () => {
    const backend = broken(() => {
      throw new Error('sync');
    });
    await expect(backend.send({ method: 'GET', url: '/v1/health' })).rejects.toThrow();
    await expect(backend.close?.()).rejects.toBeInstanceOf(ContractViolationError);
  });

  it('rethrows the teardown error when there are no violations', async () => {
    const backend = broken(() => Promise.reject(new Error('teardown')));
    await expect(backend.close?.()).rejects.toThrow('teardown');
    const silent = broken(() => Promise.reject(undefined));
    await expect(silent.close?.()).rejects.toThrow('Backend close failed');
  });

  it('trims long bodies in violation messages', () => {
    const body = { error: 'x'.repeat(1000) };
    const message = contractViolation({ method: 'GET', url: '/v1/health' }, { status: 500, body });
    expect(message).toContain('…');
    expect(message).not.toContain(JSON.stringify(body));
  });

  it('checks the bare /v1 path too', () => {
    expect(
      contractViolation({ method: 'GET', url: '/v1' }, { status: 404, body: 'nope' }),
    ).not.toBeNull();
  });
});
