import { ApiError } from '../primitives.js';
import { routes, type RouteDef } from '../routes.js';
import { TEST_CONTROL_PATHS } from '../testControls.js';
import type { BackendRequest, BackendResponse, ScenarioBackend } from './harness.js';

/**
 * Contract checking for scenario backends (NSTOCK-0238, spec backend-core acceptance 23). Every
 * response a wrapped backend gives, whether the scenario used `call`, `callError` or raw `send`,
 * must match the route map: a 2xx body parses with its route's response schema and any other
 * status carries an ApiError body. New routes in the map are covered with no extra wiring.
 */

export type RouteMap = Readonly<Record<string, RouteDef>>;

export type MatchedRoute = { name: string; def: RouteDef };

const TEST_CONTROL_PREFIX = TEST_CONTROL_PATHS.clock.slice(
  0,
  TEST_CONTROL_PATHS.clock.lastIndexOf('/'),
);

type CompiledRoute = MatchedRoute & { pattern: RegExp; staticSegments: number };

const compiled = new WeakMap<RouteMap, readonly CompiledRoute[]>();

function compile(routeMap: RouteMap): readonly CompiledRoute[] {
  const cached = compiled.get(routeMap);
  if (cached) return cached;
  const list = Object.entries(routeMap).map(([name, def]) => {
    const segments = def.path.split('/');
    const source = segments
      .map((segment) =>
        segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('/');
    return {
      name,
      def,
      pattern: new RegExp(`^${source}$`),
      staticSegments: segments.filter((segment) => !segment.startsWith(':')).length,
    };
  });
  // A static segment beats a param (`/v1/watchlists/order` before `/v1/watchlists/:id`), as in
  // Fastify's router.
  list.sort((a, b) => b.staticSegments - a.staticSegments);
  compiled.set(routeMap, list);
  return list;
}

/** The route `method url` hits (query string ignored), or null when the map has none. */
export function matchRoute(
  method: string,
  url: string,
  routeMap: RouteMap = routes,
): MatchedRoute | null {
  const path = url.split('?')[0] ?? url;
  const upper = method.toUpperCase();
  const hit = compile(routeMap).find(
    (route) => route.def.method === upper && route.pattern.test(path),
  );
  return hit ? { name: hit.name, def: hit.def } : null;
}

/**
 * Why `response` to `request` breaks the contract, or null when it keeps it.
 * - `/v1/__test` controls are not in the map on purpose and are skipped, as is anything
 *   outside `/v1`.
 * - Any non-2xx under `/v1` (a 404 for an unknown path too) must carry an ApiError body.
 * - A 2xx must come from a route in the map and parse with its response schema.
 */
export function contractViolation(
  request: BackendRequest,
  response: BackendResponse,
  routeMap: RouteMap = routes,
): string | null {
  const path = request.url.split('?')[0] ?? request.url;
  if (!path.startsWith('/v1/') || path.startsWith(`${TEST_CONTROL_PREFIX}/`)) return null;
  const match = matchRoute(request.method, request.url, routeMap);
  const label = `${request.method} ${request.url}${match ? ` (route "${match.name}")` : ''}`;
  const ok = response.status >= 200 && response.status < 300;
  if (!ok) {
    const parsed = ApiError.safeParse(response.body);
    if (parsed.success) return null;
    return `${label} answered ${String(response.status)} without an ApiError body (${parsed.error.message}): ${bodyExcerpt(response.body)}`;
  }
  if (!match) {
    return `${label} answered ${String(response.status)} but no route in the map has that method and path`;
  }
  const parsed = match.def.response.safeParse(response.body);
  if (parsed.success) return null;
  return `${label} answered ${String(response.status)} with a body that breaks its response schema (${parsed.error.message}): ${bodyExcerpt(response.body)}`;
}

/** At most 300 characters of a body for a failure message: CI logs are public (D9). */
const bodyExcerpt = (body: unknown): string => {
  const text = JSON.stringify(body) ?? String(body);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

export class ContractViolationError extends Error {
  constructor(readonly violations: readonly string[]) {
    super(
      `${String(violations.length)} contract violation(s):\n${violations.map((v) => `- ${v}`).join('\n')}`,
    );
    this.name = 'ContractViolationError';
  }
}

export type ContractCheckedBackend = ScenarioBackend & {
  /** Every violation seen so far, across all scopes. */
  readonly violations: readonly string[];
};

/**
 * Wraps a scenario backend so every response is checked with `contractViolation`. A violation
 * fails the request at once (`ContractViolationError`), and `close` fails again with all of them,
 * so a scenario that swallowed the error still fails the suite.
 */
export function contractChecked(
  backend: ScenarioBackend,
  routeMap: RouteMap = routes,
): ContractCheckedBackend {
  const violations: string[] = [];

  const wrap = (inner: ScenarioBackend): ScenarioBackend => ({
    ...inner,
    async send(request) {
      const response = await inner.send(request);
      const violation = contractViolation(request, response, routeMap);
      if (violation) {
        violations.push(violation);
        throw new ContractViolationError([violation]);
      }
      return response;
    },
    ...(inner.scope ? { scope: (index: number) => wrap(inner.scope?.(index) ?? inner) } : {}),
  });

  return {
    ...wrap(backend),
    violations,
    async close() {
      // The violations are reported even when the inner teardown fails.
      let teardown: unknown = null;
      await Promise.resolve(backend.close?.()).catch((error: unknown) => {
        teardown = error ?? new Error('Backend close failed');
      });
      if (violations.length > 0) throw new ContractViolationError(violations);
      if (teardown !== null) throw teardown;
    },
  };
}
