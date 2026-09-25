import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { Session } from './auth.js';
import type { Order } from './orders.js';
import {
  buildPath,
  routes,
  type PathParamNames,
  type RouteBody,
  type RouteDef,
  type RouteName,
  type RouteParams,
  type RouteResponse,
  type Routes,
} from './routes.js';

type RoutesWithoutResponse = {
  [N in RouteName]: Routes[N] extends { response: z.ZodType } ? never : N;
}[RouteName];

describe('route map types', () => {
  it('gives every route a response schema', () => {
    expectTypeOf<RoutesWithoutResponse>().toEqualTypeOf<never>();
  });

  it('refuses a route without a response schema', () => {
    const missing = {
      broken: { method: 'GET', path: '/v1/broken', auth: 'public' },
    };
    // @ts-expect-error `response` is required on every route.
    const check: Record<string, RouteDef> = missing;
    expect(check).toBeDefined();
  });

  it('infers request and response types from the schemas', () => {
    expectTypeOf<RouteResponse<'orderPlace'>>().toEqualTypeOf<Order>();
    expectTypeOf<RouteResponse<'otpVerify'>>().toEqualTypeOf<Session>();
    expectTypeOf<RouteBody<'orderPlace'>>().toHaveProperty('qty');
    expectTypeOf<RouteBody<'health'>>().toBeNever();
    expectTypeOf<RouteParams<'watchlistItemRemove'>>().toHaveProperty('token');
    expectTypeOf<PathParamNames<'/v1/watchlists/:id/items/:token'>>().toEqualTypeOf<
      'id' | 'token'
    >();
    expectTypeOf<PathParamNames<'/v1/orders'>>().toBeNever();
  });
});

const entries = Object.entries(routes) as [RouteName, RouteDef][];

describe('route map', () => {
  it('has 37 routes', () => {
    expect(entries).toHaveLength(37);
  });

  it('keeps every path under /v1 and every method+path unique', () => {
    const keys = entries.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [, route] of entries) {
      expect(route.path.startsWith('/v1/')).toBe(true);
    }
  });

  it('declares a params schema exactly matching the path params', () => {
    for (const [name, route] of entries) {
      const pathParams = [...route.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]).sort();
      const shape = (route.params as z.ZodObject | undefined)?.shape ?? {};
      expect(Object.keys(shape).sort(), name).toEqual(pathParams);
    }
  });

  it('only puts bodies on write methods', () => {
    for (const [name, route] of entries) {
      if (route.body) {
        expect(['POST', 'PUT', 'PATCH'], name).toContain(route.method);
      }
    }
  });

  it('keeps market routes public and account routes private', () => {
    for (const [name, route] of entries) {
      if (route.path.startsWith('/v1/market/')) expect(route.auth, name).toBe('public');
      if (/^\/v1\/(watchlists|orders|positions|holdings|portfolio|funds)/.test(route.path)) {
        expect(route.auth, name).toBe('user');
      }
    }
  });

  it('covers every endpoint area in the spec', () => {
    expect(Object.keys(routes)).toEqual(
      expect.arrayContaining([
        'health',
        'otpRequest',
        'otpVerify',
        'pinSet',
        'pinVerify',
        'sessionGet',
        'logout',
        'marketIndices',
        'marketLists',
        'marketMovers',
        'marketQuotes',
        'marketSearch',
        'instrument',
        'instrumentCandles',
        'instrumentDepth',
        'instrumentStats',
        'watchlistsList',
        'watchlistCreate',
        'watchlistRename',
        'watchlistDelete',
        'watchlistItemAdd',
        'watchlistItemRemove',
        'watchlistItemsReorder',
        'ordersList',
        'orderPlace',
        'orderModify',
        'orderCancel',
        'positionsList',
        'holdingsList',
        'portfolioSummary',
        'fundsSummary',
        'fundsLedger',
        'fundsReset',
      ]),
    );
  });

  it('validates a health response', () => {
    expect(
      routes.health.response.parse({
        status: 'ok',
        version: '0.0.0',
        time: '2026-09-25T04:00:00Z',
      }),
    ).toEqual({ status: 'ok', version: '0.0.0', time: '2026-09-25T04:00:00Z' });
  });
});

describe('buildPath', () => {
  it('fills and encodes params', () => {
    expect(buildPath(routes.instrumentDepth.path, { symbol: 'M&M' })).toBe(
      '/v1/market/instruments/M%26M/depth',
    );
    expect(buildPath(routes.watchlistItemRemove.path, { id: 'wl_1', token: 408065 })).toBe(
      '/v1/watchlists/wl_1/items/408065',
    );
    expect(buildPath(routes.health.path)).toBe('/v1/health');
  });

  it('throws on a missing param', () => {
    expect(() => buildPath(routes.orderGet.path, {})).toThrow('Missing path param "id"');
  });
});
