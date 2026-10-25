import type { RouteDef } from '@nthstock/contracts';

/** One route as Fastify registered it (`onRoute`), e.g. `{ method: 'GET', url: '/v1/health' }`. */
export type RegisteredRoute = { method: string | readonly string[]; url: string };

/** Methods Fastify adds on its own (HEAD beside every GET) that the route map never lists. */
const IMPLICIT_METHODS = new Set(['HEAD', 'OPTIONS']);

/**
 * Where the Fastify app and the route map disagree (NSTOCK-0238, spec backend-core acceptance 23):
 * - a route in the map that Fastify does not have with the same method and path;
 * - a `/v1` route Fastify has that is neither in the map nor in `allowedOutsideMap` (paths).
 * Each gap is one message naming the route key, empty when they agree.
 */
export function findContractGaps(
  appRoutes: readonly RegisteredRoute[],
  routeMap: Readonly<Record<string, RouteDef>>,
  allowedOutsideMap: readonly string[] = [],
): string[] {
  const registered = new Set<string>();
  for (const route of appRoutes) {
    const methods = typeof route.method === 'string' ? [route.method] : route.method;
    for (const method of methods) registered.add(`${method.toUpperCase()} ${route.url}`);
  }
  const inMap = new Set(Object.values(routeMap).map((def) => `${def.method} ${def.path}`));

  const gaps: string[] = [];
  for (const [name, def] of Object.entries(routeMap)) {
    if (!registered.has(`${def.method} ${def.path}`)) {
      gaps.push(
        `Route "${name}" (${def.method} ${def.path}) is in the route map but Fastify does not register it`,
      );
    }
  }
  const allowed = new Set(allowedOutsideMap);
  for (const key of registered) {
    const [method = '', url = ''] = key.split(' ');
    if (IMPLICIT_METHODS.has(method) || !url.startsWith('/v1/') || allowed.has(url)) continue;
    if (!inMap.has(key)) {
      gaps.push(`${key} is registered in Fastify but missing from the route map`);
    }
  }
  return gaps;
}
