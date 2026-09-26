import {
  buildPath,
  routes,
  type RouteBody,
  type RouteName,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
  type Routes,
} from '@nthstock/contracts';
import { ApiError } from './apiError.js';

/** Header carrying the CSRF token on state-changing requests (CLAUDE.md §4). */
export const CSRF_HEADER = 'X-CSRF-Token';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  /**
   * Prepended to every route path, which already starts with `/v1`. Empty (the default) means the
   * page's own origin; Node callers pass an absolute origin such as `http://localhost:8080`.
   */
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch, looked up on each call. */
  fetch?: FetchLike;
  /** Returns the CSRF token for POST, PUT, PATCH and DELETE; nothing is sent when it returns null. */
  csrfToken?: () => string | null | undefined;
};

type Part<N extends RouteName, K extends 'params' | 'query' | 'body', V> = Routes[N] extends {
  [P in K]: unknown;
}
  ? // Optional when every field is optional (e.g. `?exchange=`), required otherwise.
    object extends V
    ? { [P in K]?: V }
    : { [P in K]: V }
  : { [P in K]?: never };

/** What a call to route `N` takes: its params, query and body, each only when the route has one. */
export type RequestArgs<N extends RouteName> = Part<N, 'params', RouteParams<N>> &
  Part<N, 'query', RouteQuery<N>> &
  Part<N, 'body', RouteBody<N>> & { signal?: AbortSignal };

/** The argument list: optional when nothing in it is required. */
export type RequestArgList<N extends RouteName> =
  object extends RequestArgs<N> ? [args?: RequestArgs<N>] : [args: RequestArgs<N>];

export type ApiClient = {
  /** Calls a route from the contracts route map and returns its Zod-parsed response. */
  request<N extends RouteName>(name: N, ...args: RequestArgList<N>): Promise<RouteResponse<N>>;
  /** The URL a call would hit, for logging and cache keys. */
  url<N extends RouteName>(name: N, ...args: RequestArgList<N>): string;
};

type Scalar = string | number | boolean;

function queryString(query: unknown): string {
  if (query === undefined || query === null) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    search.set(key, Array.isArray(value) ? value.join(',') : String(value as Scalar));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Linear-time `replace(/\/+$/, '')`; the regex backtracks on long runs of '/' (CodeQL). */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
  return url.slice(0, end);
}

/**
 * Typed REST client over the contracts route map, shared by web and (later) mobile. Isomorphic:
 * only fetch, no DOM. Cookies ride along (`credentials: 'include'`); every failure is an ApiError.
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? '');

  const urlFor = (name: RouteName, args: { params?: unknown; query?: unknown } = {}) => {
    const route = routes[name];
    const path = buildPath(route.path, (args.params ?? {}) as Record<string, string | number>);
    return `${baseUrl}${path}${queryString(args.query)}`;
  };

  return {
    url(name, ...[args]) {
      return urlFor(name, args);
    },

    async request(name, ...[args]) {
      const route = routes[name];
      const headers: Record<string, string> = { Accept: 'application/json' };
      const init: RequestInit = { method: route.method, credentials: 'include', headers };
      if (args?.signal) init.signal = args.signal;
      if (args?.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(args.body);
      }
      if (route.method !== 'GET') {
        const token = options.csrfToken?.();
        if (token) headers[CSRF_HEADER] = token;
      }

      const doFetch: FetchLike = options.fetch ?? ((input, req) => globalThis.fetch(input, req));
      let response: Response;
      try {
        response = await doFetch(urlFor(name, args), init);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError({
          kind: 'network',
          status: 0,
          code: 'SERVICE_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Network request failed',
          cause: error,
        });
      }

      const body = await readBody(response);
      if (!response.ok) throw ApiError.fromResponse(response.status, body, response.statusText);

      const parsed = route.response.safeParse(body);
      if (!parsed.success) {
        throw new ApiError({
          kind: 'contract',
          status: response.status,
          code: 'INTERNAL_ERROR',
          message: `Response for ${name} does not match its contract`,
          details: { issues: parsed.error.issues },
        });
      }
      return parsed.data as RouteResponse<typeof name>;
    },
  };
}
