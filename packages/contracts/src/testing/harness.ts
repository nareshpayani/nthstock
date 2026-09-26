import { afterAll, beforeAll, describe, it } from 'vitest';
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

/**
 * Dual-backend scenario harness (T-060). A scenario talks to a `ScenarioBackend`, which is either
 * the MSW node server (apps/web, via `fetchBackend`) or Fastify `app.inject` (apps/api). The same
 * scenario file runs against both, so any drift between the two mock modes fails CI (ADR 0004).
 */

/** One HTTP exchange as a backend sees it. `url` is the path plus query string, e.g. `/v1/x?a=1`. */
export type BackendRequest = { method: HttpMethod; url: string; body?: unknown };
export type BackendResponse = { status: number; body: unknown };

export interface ScenarioBackend {
  send(request: BackendRequest): Promise<BackendResponse>;
  /** Frees the backend after the suite (close the app, stop the server). */
  close?(): void | Promise<void>;
}

type QueryValue = string | number | boolean | undefined;

/** A request by route name, typed from the route map. */
export type CallInput<N extends RouteName> = {
  params?: RouteParams<N>;
  query?: RouteQuery<N>;
  body?: RouteBody<N>;
};

/** A request that may break the contract on purpose (to check 400s). */
export type LooseInput = {
  params?: Record<string, string | number>;
  query?: Record<string, QueryValue>;
  body?: unknown;
};

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

export interface ScenarioClient {
  /** Calls a route, expects 2xx and returns the body parsed by the route's response schema. */
  call<N extends RouteName>(name: N, input?: CallInput<N>): Promise<RouteResponse<N>>;
  /** Calls a route, expects a non-2xx and returns the status with the parsed ApiError body. */
  callError(name: RouteName, input?: LooseInput): Promise<ErrorResult>;
  /** Sends anything; no checks. */
  send(request: BackendRequest): Promise<BackendResponse>;
}

/** `{ q: 'inf', limit: 5 }` → `?q=inf&limit=5`; undefined values are left out. */
export function toQueryString(query: Readonly<Record<string, QueryValue>> = {}): string {
  const parts = Object.entries(query)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

function toRequest(name: RouteName, input: LooseInput): BackendRequest {
  const def = routes[name];
  const url = buildPath(def.path, input.params) + toQueryString(input.query);
  return input.body === undefined
    ? { method: def.method, url }
    : { method: def.method, url, body: input.body };
}

const isOk = (status: number) => status >= 200 && status < 300;

export function createScenarioClient(backend: ScenarioBackend): ScenarioClient {
  return {
    async call<N extends RouteName>(name: N, input: CallInput<N> = {}) {
      const response = await backend.send(toRequest(name, input as LooseInput));
      if (!isOk(response.status)) throw new ScenarioError(`${name} failed`, response);
      const parsed = routes[name].response.safeParse(response.body);
      if (!parsed.success) {
        throw new ScenarioError(
          `${name} broke its response schema (${parsed.error.message})`,
          response,
        );
      }
      return parsed.data as RouteResponse<N>;
    },
    async callError(name, input = {}) {
      const response = await backend.send(toRequest(name, input));
      if (isOk(response.status)) throw new ScenarioError(`${name} was expected to fail`, response);
      const parsed = ApiError.safeParse(response.body);
      if (!parsed.success) throw new ScenarioError(`${name} error is not an ApiError`, response);
      return { status: response.status, body: parsed.data };
    },
    send: (request) => backend.send(request),
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
 * `createBackend` runs once in `beforeAll`; the backend is closed in `afterAll`.
 */
export function runScenarioSuite(
  backendName: string,
  groups: readonly ScenarioGroup[],
  createBackend: () => ScenarioBackend | Promise<ScenarioBackend>,
): void {
  describe(`scenarios against ${backendName}`, () => {
    let backend: ScenarioBackend | undefined;
    let client: ScenarioClient | undefined;

    beforeAll(async () => {
      backend = await createBackend();
      client = createScenarioClient(backend);
    });

    afterAll(async () => {
      await backend?.close?.();
    });

    for (const group of groups) {
      describe(group.title, () => {
        for (const scenario of group.scenarios) {
          it(scenario.name, async () => {
            if (!client) throw new Error(`Backend ${backendName} did not start`);
            await scenario.run(client);
          });
        }
      });
    }
  });
}
