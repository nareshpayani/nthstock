import {
  routes,
  type ApiError,
  type ApiErrorCode,
  type RouteName,
  type RouteResponse,
  type Routes,
} from '@nthstock/contracts';
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import type { z } from 'zod';

/**
 * Builds MSW handlers straight from the contracts route map (T-051): the method and path come from
 * `routes`, params, query and body are Zod-validated before the resolver runs (400 on failure, like
 * apps/api), and the resolver's return value is checked against the route's response schema.
 */

// ---- Latency ---------------------------------------------------------------------------------

export type Latency = { minMs: number; maxMs: number };

/** Default simulated network latency in the browser. Tests set it to 0. */
export const DEFAULT_LATENCY: Latency = { minMs: 50, maxMs: 150 };
let latency: Latency = DEFAULT_LATENCY;

export function setMockLatency(minMs: number, maxMs: number = minMs): void {
  if (minMs < 0 || maxMs < minMs) throw new RangeError('Latency must satisfy 0 ≤ min ≤ max');
  latency = { minMs, maxMs };
}

export function getMockLatency(): Latency {
  return latency;
}

/** A latency in [min, max] ms. */
export function pickLatency(random: () => number = Math.random, range: Latency = latency): number {
  return Math.round(range.minMs + random() * (range.maxMs - range.minMs));
}

// ---- Errors ----------------------------------------------------------------------------------

/** Throw from a resolver to answer with the ApiError envelope, e.g. a 404 for an unknown symbol. */
export class MockApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  return HttpResponse.json(body, { status });
}

export const notFound = (what: string): never => {
  throw new MockApiError(404, 'NOT_FOUND', `${what} not found`);
};

/** A resolver whose body broke the contract. Logged loudly and answered with a 500. */
export type ContractViolation = { route: RouteName; issues: z.core.$ZodIssue[]; body: unknown };

const logViolation = (violation: ContractViolation) => {
  console.error(
    `[mocks] ${violation.route} returned a body that breaks its response schema`,
    violation.issues,
  );
};

// ---- Handlers --------------------------------------------------------------------------------

type Parsed<N extends RouteName, K extends 'params' | 'query' | 'body'> = Routes[N] extends {
  [P in K]: infer S;
}
  ? S extends z.ZodType
    ? z.output<S>
    : undefined
  : undefined;

export type ResolverContext<N extends RouteName> = {
  params: Parsed<N, 'params'>;
  query: Parsed<N, 'query'>;
  body: Parsed<N, 'body'>;
  request: Request;
};

export type RouteResolver<N extends RouteName> = (
  context: ResolverContext<N>,
) => RouteResponse<N> | Promise<RouteResponse<N>>;

export type RouteHandlerOptions = {
  /** Origin the handler matches. Default `*`: any origin, so the API base URL can change freely. */
  origin?: string;
  /** Called when a resolver's body breaks the response schema. Default: console.error. */
  onContractViolation?: (violation: ContractViolation) => void;
};

type Methods = 'get' | 'post' | 'put' | 'patch' | 'delete';

function validate(schema: z.ZodType | undefined, value: unknown, what: string) {
  if (!schema) return { ok: true as const, data: undefined };
  const result = schema.safeParse(value);
  if (result.success) return { ok: true as const, data: result.data };
  return {
    ok: false as const,
    response: errorResponse(400, 'VALIDATION_ERROR', `Invalid ${what}`, {
      issues: result.error.issues,
    }),
  };
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Symbol('invalid json'); // fails any body schema
  }
}

/** One MSW handler for route `name`, typed end to end from the route map. */
export function defineRoute<N extends RouteName>(
  name: N,
  resolver: RouteResolver<N>,
  options: RouteHandlerOptions = {},
): HttpHandler {
  const route = routes[name] as Routes[N] & {
    params?: z.ZodType;
    query?: z.ZodType;
    body?: z.ZodType;
    response: z.ZodType;
  };
  const method = route.method.toLowerCase() as Methods;
  const report = options.onContractViolation ?? logViolation;

  return http[method](`${options.origin ?? '*'}${route.path}`, async ({ request, params }) => {
    const wait = pickLatency();
    if (wait > 0) await delay(wait);

    const url = new URL(request.url);
    const checkedParams = validate(route.params, params, 'path parameters');
    if (!checkedParams.ok) return checkedParams.response;
    const checkedQuery = validate(
      route.query,
      Object.fromEntries(url.searchParams),
      'query parameters',
    );
    if (!checkedQuery.ok) return checkedQuery.response;
    const checkedBody = route.body
      ? validate(route.body, await readJson(request), 'request body')
      : validate(undefined, undefined, '');
    if (!checkedBody.ok) return checkedBody.response;

    let body: unknown;
    try {
      body = await resolver({
        params: checkedParams.data,
        query: checkedQuery.data,
        body: checkedBody.data,
        request,
      } as ResolverContext<N>);
    } catch (error) {
      if (error instanceof MockApiError) {
        return errorResponse(error.status, error.code, error.message, error.details);
      }
      throw error;
    }

    const checked = route.response.safeParse(body);
    if (!checked.success) {
      report({ route: name, issues: checked.error.issues, body });
      return errorResponse(500, 'INTERNAL_ERROR', `Mock ${name} broke its response contract`, {
        issues: checked.error.issues,
      });
    }
    return HttpResponse.json(body as Record<string, unknown>);
  });
}
