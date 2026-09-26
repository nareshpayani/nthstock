import { afterAll, beforeAll, describe, it } from 'vitest';
import { AUTH_CSRF_HEADER, Session } from '../auth.js';
import { ApiError } from '../primitives.js';
import {
  buildPath,
  routes,
  type HttpMethod,
  type RouteBody,
  type RouteName,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
} from '../routes.js';
import { createCookieJar, type CookieJar } from './cookieJar.js';

/**
 * Dual-backend scenario harness (T-060). A scenario talks to a `ScenarioBackend`, which is either
 * the MSW node server (apps/web, via `fetchBackend`) or Fastify `app.inject` (apps/api). The same
 * scenario file runs against both, so any drift between the two mock modes fails CI (ADR 0004).
 */

/** One HTTP exchange as a backend sees it. `url` is the path plus query string, e.g. `/v1/x?a=1`. */
export type BackendRequest = {
  method: HttpMethod;
  url: string;
  body?: unknown;
  /** Extra request headers (cookies, CSRF); left out when there are none. */
  headers?: Record<string, string>;
};
export type BackendResponse = {
  status: number;
  body: unknown;
  /** Raw `Set-Cookie` lines, one per cookie. */
  setCookies?: readonly string[];
};

export interface ScenarioBackend {
  send(request: BackendRequest): Promise<BackendResponse>;
  /** Frees the backend after the suite (close the app, stop the server). */
  close?(): void | Promise<void>;
  /**
   * The backend as one scenario's client sees it: its own client address or cookie domain, so no
   * per-IP counter or stored cookie carries over from another scenario. Left out: shared.
   */
  scope?(index: number): ScenarioBackend;
  /** Moves the backend's auth clock forward (OTP throttle, token expiry). */
  advanceTime?(ms: number): void | Promise<void>;
}

type QueryValue = string | number | boolean | undefined;

/** How a request carries the CSRF header: the client's own (default), a given value, or none. */
export type CsrfChoice = { csrf?: string | false };

/** A request by route name, typed from the route map. */
export type CallInput<N extends RouteName> = {
  params?: RouteParams<N>;
  query?: RouteQuery<N>;
  body?: RouteBody<N>;
} & CsrfChoice;

/** A request that may break the contract on purpose (to check 400s). */
export type LooseInput = {
  params?: Record<string, string | number>;
  query?: Record<string, QueryValue>;
  body?: unknown;
} & CsrfChoice;

/** The CSRF header value the client sends before it has a session (any non-empty value works). */
export const PRE_SESSION_CSRF = 'scenario-pre-session';

export type ErrorResult = { status: number; body: ApiError };

export class ScenarioError extends Error {
  constructor(
    message: string,
    readonly response: BackendResponse,
  ) {
    super(`${message}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
    this.name = 'ScenarioError';
  }
}

/**
 * A scenario's client behaves like one browser tab running the web app: it keeps the cookies the
 * backend sets and sends them back, and sends the CSRF header on state-changing requests (the
 * token of the last Session it received, or `PRE_SESSION_CSRF` before one).
 */
export interface ScenarioClient {
  /** Calls a route, expects 2xx and returns the body parsed by the route's response schema. */
  call<N extends RouteName>(name: N, input?: CallInput<N>): Promise<RouteResponse<N>>;
  /** Calls a route, expects a non-2xx and returns the status with the parsed ApiError body. */
  callError(name: RouteName, input?: LooseInput): Promise<ErrorResult>;
  /** Sends anything; no checks, no cookies or CSRF header added. */
  send(request: BackendRequest): Promise<BackendResponse>;
  readonly cookies: CookieJar;
  /** The CSRF token of the current session, or null. */
  csrfToken(): string | null;
  /** Moves the backend's auth clock forward; fails when the backend cannot. */
  advanceTime(ms: number): Promise<void>;
}

/** `{ q: 'inf', limit: 5 }` → `?q=inf&limit=5`; undefined values are left out. */
export function toQueryString(query: Readonly<Record<string, QueryValue>> = {}): string {
  const parts = Object.entries(query)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

const isOk = (status: number) => status >= 200 && status < 300;

export function createScenarioClient(backend: ScenarioBackend): ScenarioClient {
  const cookies = createCookieJar();
  let csrf: string | null = null;

  function toRequest(name: RouteName, input: LooseInput): BackendRequest {
    const def = routes[name];
    const url = buildPath(def.path, input.params) + toQueryString(input.query);
    const headers: Record<string, string> = {};
    const cookie = cookies.header();
    if (cookie) headers['cookie'] = cookie;
    if (def.method !== 'GET' && input.csrf !== false) {
      headers[AUTH_CSRF_HEADER] = input.csrf ?? csrf ?? PRE_SESSION_CSRF;
    }
    return {
      method: def.method,
      url,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  async function exchange(name: RouteName, input: LooseInput) {
    const response = await backend.send(toRequest(name, input));
    cookies.store(response.setCookies ?? []);
    return response;
  }

  return {
    async call<N extends RouteName>(name: N, input: CallInput<N> = {}) {
      const response = await exchange(name, input as LooseInput);
      if (!isOk(response.status)) throw new ScenarioError(`${name} failed`, response);
      const parsed = routes[name].response.safeParse(response.body);
      if (!parsed.success) {
        throw new ScenarioError(
          `${name} broke its response schema (${parsed.error.message})`,
          response,
        );
      }
      if (routes[name].response === Session) csrf = (parsed.data as Session).csrfToken;
      if (name === 'logout') csrf = null;
      return parsed.data as RouteResponse<N>;
    },
    async callError(name, input = {}) {
      const response = await exchange(name, input);
      if (isOk(response.status)) throw new ScenarioError(`${name} was expected to fail`, response);
      const parsed = ApiError.safeParse(response.body);
      if (!parsed.success) throw new ScenarioError(`${name} error is not an ApiError`, response);
      return { status: response.status, body: parsed.data };
    },
    send: (request) => backend.send(request),
    cookies,
    csrfToken: () => csrf,
    async advanceTime(ms) {
      if (!backend.advanceTime) throw new Error('This backend cannot move its clock');
      await backend.advanceTime(ms);
    },
  };
}

export type Scenario = {
  name: string;
  run(client: ScenarioClient): Promise<void>;
};

export type ScenarioGroup = { title: string; scenarios: readonly Scenario[] };

export const defineScenarios = (title: string, scenarios: readonly Scenario[]): ScenarioGroup => ({
  title,
  scenarios,
});

/**
 * Registers a Vitest suite that runs every scenario in `groups` against one backend.
 * `createBackend` runs once in `beforeAll`; the backend is closed in `afterAll`. Each scenario gets
 * a fresh client (its own cookies) on its own `scope` of the backend.
 */
export function runScenarioSuite(
  backendName: string,
  groups: readonly ScenarioGroup[],
  createBackend: () => ScenarioBackend | Promise<ScenarioBackend>,
): void {
  describe(`scenarios against ${backendName}`, () => {
    let backend: ScenarioBackend | undefined;
    let index = 0;

    beforeAll(async () => {
      backend = await createBackend();
    });

    afterAll(async () => {
      await backend?.close?.();
    });

    for (const group of groups) {
      describe(group.title, () => {
        for (const scenario of group.scenarios) {
          it(scenario.name, async () => {
            if (!backend) throw new Error(`Backend ${backendName} did not start`);
            index += 1;
            await scenario.run(createScenarioClient(backend.scope?.(index) ?? backend));
          });
        }
      });
    }
  });
}
