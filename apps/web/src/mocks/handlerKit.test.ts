// @vitest-environment node
import type { routes } from '@nthstock/contracts';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LATENCY,
  MockApiError,
  defineRoute,
  getMockLatency,
  pickLatency,
  setMockLatency,
  type ContractViolation,
  type RouteResolver,
} from './handlerKit';

const ORIGIN = 'http://kit.test';
const violations: ContractViolation[] = [];
const onContractViolation = (v: ContractViolation) => violations.push(v);
const server = setupServer();

beforeAll(() => {
  setMockLatency(0);
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  violations.length = 0;
});
afterAll(() => {
  server.close();
});

const use = <N extends keyof typeof routes>(name: N, resolver: RouteResolver<N>) => {
  server.use(defineRoute(name, resolver, { origin: ORIGIN, onContractViolation }));
};

describe('defineRoute', () => {
  it('serves a valid body with the method and path from the route map', async () => {
    use('health', () => ({ status: 'ok', version: 'test', time: '2026-09-25T04:00:00.000Z' }));
    const response = await fetch(`${ORIGIN}/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
    expect(violations).toEqual([]);
  });

  it('a handler returning an invalid body fails with a 500 and a reported violation', async () => {
    // Deliberately wrong: `status` must be 'ok' and `time` an ISO timestamp.
    use('health', () => ({ status: 'down', version: 'x', time: 'noon' }) as never);
    const response = await fetch(`${ORIGIN}/v1/health`);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.route).toBe('health');
    expect(violations[0]?.issues.map((i) => i.path.join('.'))).toEqual(['status', 'time']);
  });

  it('logs violations to the console by default', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.use(defineRoute('health', () => ({}) as never, { origin: ORIGIN }));
    expect((await fetch(`${ORIGIN}/v1/health`)).status).toBe(500);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('health returned a body that breaks'),
      expect.any(Array),
    );
    log.mockRestore();
  });

  it('validates params, query and body before the resolver, answering 400', async () => {
    const resolver = vi.fn(() => {
      throw new Error('should not run');
    });
    use('instrument', resolver);
    use('marketMovers', resolver);
    use('watchlistCreate', resolver);
    const bad = [
      await fetch(`${ORIGIN}/v1/market/instruments/infy`),
      await fetch(`${ORIGIN}/v1/market/movers?index=NIFTY50&direction=up`),
      await fetch(`${ORIGIN}/v1/watchlists`, { method: 'POST', body: '{"name":""}' }),
      await fetch(`${ORIGIN}/v1/watchlists`, { method: 'POST', body: 'not json' }),
      await fetch(`${ORIGIN}/v1/watchlists`, { method: 'POST' }),
    ];
    for (const response of bad) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it('hands the resolver parsed (coerced) values', async () => {
    const seen = vi.fn();
    use('marketSearch', ({ query }) => {
      seen(query);
      return { items: [] };
    });
    use('watchlistCreate', ({ body }) => {
      seen(body);
      const at = '2026-09-25T04:00:00.000Z';
      return { id: 'wl_1', name: body.name, items: [], createdAt: at, updatedAt: at };
    });
    await fetch(`${ORIGIN}/v1/market/search?q=%20inf%20&limit=5`);
    await fetch(`${ORIGIN}/v1/watchlists`, { method: 'POST', body: '{"name":"Tech"}' });
    expect(seen).toHaveBeenNthCalledWith(1, { q: 'inf', limit: 5 });
    expect(seen).toHaveBeenNthCalledWith(2, { name: 'Tech' });
  });

  it('turns a thrown MockApiError into the ApiError envelope and rethrows anything else', async () => {
    use('instrument', () => {
      throw new MockApiError(409, 'CONFLICT', 'Busy', { retry: true });
    });
    const response = await fetch(`${ORIGIN}/v1/market/instruments/INFY`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'CONFLICT', message: 'Busy', details: { retry: true } },
    });

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    use('health', () => {
      throw new Error('boom');
    });
    expect((await fetch(`${ORIGIN}/v1/health`)).status).toBe(500);
    log.mockRestore();
  });

  it('waits for the configured latency', async () => {
    use('health', () => ({ status: 'ok', version: 'test', time: '2026-09-25T04:00:00.000Z' }));
    setMockLatency(30);
    const started = performance.now();
    await fetch(`${ORIGIN}/v1/health`);
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    setMockLatency(0);
  });
});

describe('latency', () => {
  it('defaults to 50–150 ms and picks within the range', () => {
    expect(DEFAULT_LATENCY).toEqual({ minMs: 50, maxMs: 150 });
    expect(pickLatency(() => 0, DEFAULT_LATENCY)).toBe(50);
    expect(pickLatency(() => 1, DEFAULT_LATENCY)).toBe(150);
    expect(pickLatency(() => 0.5, DEFAULT_LATENCY)).toBe(100);
  });

  it('is configurable, 0 in tests, and rejects impossible ranges', () => {
    setMockLatency(10, 20);
    expect(getMockLatency()).toEqual({ minMs: 10, maxMs: 20 });
    expect(pickLatency(() => 0.5)).toBe(15);
    setMockLatency(0);
    expect(pickLatency()).toBe(0);
    expect(() => setMockLatency(-1)).toThrow(RangeError);
    expect(() => setMockLatency(20, 10)).toThrow(RangeError);
  });
});
