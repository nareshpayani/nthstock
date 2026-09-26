import {
  routes,
  type RouteDef,
  type RouteName,
  type RouteResponse,
  type Routes,
} from '@nthstock/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ApiHttpError } from './apiError.js';

type Part = 'params' | 'query' | 'body';

/** The parsed (post-coercion) value of a route's params, query or body; `undefined` when absent. */
export type Parsed<N extends RouteName, K extends Part> = Routes[N] extends { [P in K]: infer S }
  ? S extends z.ZodType
    ? z.output<S>
    : undefined
  : undefined;

export type HandlerContext<N extends RouteName> = {
  params: Parsed<N, 'params'>;
  query: Parsed<N, 'query'>;
  body: Parsed<N, 'body'>;
  request: FastifyRequest;
  reply: FastifyReply;
};

export type RouteHandler<N extends RouteName> = (
  context: HandlerContext<N>,
) => RouteResponse<N> | Promise<RouteResponse<N>>;

/** Rejects the request (throw an `ApiHttpError` 401) when it has no valid session. */
export type Authenticate = (request: FastifyRequest) => void | Promise<void>;

export type RegisterRouteOptions = {
  /** Required for `auth: 'user'` routes; registration fails closed without it. */
  authenticate?: Authenticate;
  /**
   * Check every response body against the route's schema and answer 500 on a mismatch.
   * Default true: a contract break is a bug and must not reach clients.
   */
  validateResponse?: boolean;
};

/** Same wording as the MSW handler kit, so both backends answer alike. */
const PART_LABEL: Record<Part, string> = {
  params: 'path parameters',
  query: 'query parameters',
  body: 'request body',
};

function parsePart(def: RouteDef, part: Part, value: unknown): unknown {
  const schema = def[part];
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiHttpError(400, 'VALIDATION_ERROR', `Invalid ${PART_LABEL[part]}`, {
    issues: result.error.issues,
  });
}

/**
 * Registers one route from the contracts route map (T-058). Method and path come from `routes`;
 * params, query and body are Zod-parsed before the handler runs (400 VALIDATION_ERROR on failure),
 * and the handler's return value is checked against the response schema.
 */
export function registerRoute<N extends RouteName>(
  app: FastifyInstance,
  name: N,
  handler: RouteHandler<N>,
  options: RegisterRouteOptions = {},
): void {
  const def: RouteDef = routes[name];
  const { authenticate, validateResponse = true } = options;
  if (def.auth === 'user' && !authenticate) {
    throw new Error(`Route "${name}" needs a session; pass options.authenticate`);
  }

  app.route({
    method: def.method,
    url: def.path,
    handler: async (request, reply) => {
      if (authenticate) await authenticate(request);
      const context = {
        params: parsePart(def, 'params', request.params),
        query: parsePart(def, 'query', request.query),
        body: parsePart(def, 'body', request.body),
        request,
        reply,
      } as HandlerContext<N>;
      const data: unknown = await handler(context);
      if (!validateResponse) return data;
      const checked = def.response.safeParse(data);
      if (checked.success) return checked.data;
      request.log.error({ route: name, issues: checked.error.issues }, 'response breaks contract');
      throw new Error(`Response for route "${name}" breaks its schema`);
    },
  });
}
