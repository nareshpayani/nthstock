import {
  AUTH_CSRF_HEADER,
  ApiError,
  TEST_CONTROL_PATHS,
  buildPath,
  routes,
  type RouteDef,
  type RouteName,
} from '@nthstock/contracts';
import { contractViolation } from '@nthstock/contracts/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type App } from '../app.js';
import { findContractGaps, type RegisteredRoute } from './contractGaps.js';

/**
 * Route contract tests (NSTOCK-0238, spec backend-core acceptance 23): every route in the map is
 * registered in Fastify with the same method, path and auth, and nothing under `/v1` is registered
 * outside the map. They iterate the map, so a new route joins with no wiring here.
 */

/**
 * `/v1` paths Fastify may serve that are deliberately not in the route map. Keep it small, and
 * say where each one is documented.
 */
const ROUTES_OUTSIDE_THE_MAP: readonly string[] = [
  // The OpenAPI document generated from the route map itself.
  '/v1/docs/openapi.json',
  // The test-only clock and price controls (packages/contracts/src/testControls.ts).
  ...Object.values(TEST_CONTROL_PATHS),
];

/**
 * Public routes that answer 401 without a credential other than a session (keyed by route, with
 * why). Anything else public must answer without one.
 */
const PUBLIC_ROUTES_ANSWERING_401: Partial<Record<RouteName, string>> = {
  sessionRefresh: 'needs the refresh-token cookie; a missing one is a 401, as for an expired one',
};

const entries = Object.entries(routes) as [RouteName, RouteDef][];

/** A request to the route with every path param filled and no session; CSRF set off GET. */
const requestFor = (def: RouteDef) => ({
  method: def.method,
  url: buildPath(
    def.path,
    Object.fromEntries(def.path.match(/:[A-Za-z]+/g)?.map((p) => [p.slice(1), 'x1']) ?? []),
  ),
  // A state-changing request without the header is a 403 before auth runs (http/csrf.ts).
  headers: def.method === 'GET' ? {} : { [AUTH_CSRF_HEADER]: 'contract-test' },
});

describe('route contract', () => {
  let app: App;
  const registered: RegisteredRoute[] = [];

  beforeAll(async () => {
    app = buildApp({ orderSweepMs: null });
    app.addHook('onRoute', (route) => {
      registered.push({ method: route.method, url: route.url });
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers exactly the routes in the map under /v1', () => {
    expect(findContractGaps(registered, routes, ROUTES_OUTSIDE_THE_MAP)).toEqual([]);
  });

  describe.each(entries)('%s', (name, def) => {
    it(`is registered as ${def.method} ${def.path}`, () => {
      expect(
        app.hasRoute({ method: def.method, url: def.path }),
        `Route "${name}" (${def.method} ${def.path}) is not registered in Fastify`,
      ).toBe(true);
    });

    if (def.auth === 'user') {
      it('answers 401 with an ApiError without a session', async () => {
        const response = await app.inject(requestFor(def));
        expect(response.statusCode, `Route "${name}" must need a session`).toBe(401);
        expect(ApiError.safeParse(response.json()).success, `Route "${name}" 401 body`).toBe(true);
      });
    } else {
      it('answers without a session, within the contract', async () => {
        const request = requestFor(def);
        const response = await app.inject(request);
        if (PUBLIC_ROUTES_ANSWERING_401[name] === undefined) {
          expect(response.statusCode, `Public route "${name}" asked for a session`).not.toBe(401);
        }
        const body: unknown = response.body === '' ? null : response.json();
        expect(
          contractViolation(
            { method: def.method, url: request.url },
            { status: response.statusCode, body },
          ),
        ).toBeNull();
      });
    }
  });

  it('lists only public routes as answering 401', () => {
    for (const name of Object.keys(PUBLIC_ROUTES_ANSWERING_401) as RouteName[]) {
      expect(routes[name].auth, `PUBLIC_ROUTES_ANSWERING_401.${name}`).toBe('public');
    }
  });

  it('answers an unknown /v1 path with a 404 ApiError', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/not-in-the-map' });
    expect(response.statusCode).toBe(404);
    expect(ApiError.safeParse(response.json()).success).toBe(true);
  });
});

describe('findContractGaps', () => {
  const ok = z.object({});
  const map: Record<string, RouteDef> = {
    thing: { method: 'GET', path: '/v1/things/:id', auth: 'user', response: ok },
    thingCreate: { method: 'POST', path: '/v1/things', auth: 'user', response: ok },
  };
  const app: RegisteredRoute[] = [
    { method: 'GET', url: '/v1/things/:id' },
    { method: 'HEAD', url: '/v1/things/:id' },
    { method: 'POST', url: '/v1/things' },
  ];

  it('finds none when the app and the map agree', () => {
    expect(findContractGaps(app, map)).toEqual([]);
  });

  it('names a route in the map that the app does not register', () => {
    const withExtra: Record<string, RouteDef> = {
      ...map,
      thingDelete: { method: 'DELETE', path: '/v1/things/:id', auth: 'user', response: ok },
    };
    expect(findContractGaps(app, withExtra)).toEqual([
      'Route "thingDelete" (DELETE /v1/things/:id) is in the route map but Fastify does not register it',
    ]);
  });

  it('catches a route registered with another method or path', () => {
    const moved: RegisteredRoute[] = [
      { method: 'GET', url: '/v1/things/:thingId' },
      { method: 'PUT', url: '/v1/things' },
    ];
    expect(findContractGaps(moved, map)).toEqual([
      'Route "thing" (GET /v1/things/:id) is in the route map but Fastify does not register it',
      'Route "thingCreate" (POST /v1/things) is in the route map but Fastify does not register it',
      'GET /v1/things/:thingId is registered in Fastify but missing from the route map',
      'PUT /v1/things is registered in Fastify but missing from the route map',
    ]);
  });

  it('allows the listed paths, implicit methods and anything outside /v1', () => {
    const more: RegisteredRoute[] = [
      ...app,
      { method: ['GET', 'HEAD'], url: '/v1/docs/openapi.json' },
      { method: 'OPTIONS', url: '/v1/things' },
      { method: 'GET', url: '/metrics' },
    ];
    expect(findContractGaps(more, map, ['/v1/docs/openapi.json'])).toEqual([]);
    expect(findContractGaps(more, map)).toEqual([
      'GET /v1/docs/openapi.json is registered in Fastify but missing from the route map',
    ]);
  });
});
