import type { BackendRequest, ScenarioBackend } from '@nthstock/contracts/testing';
import type { FastifyInstance } from 'fastify';

export type InjectBackendOptions = {
  /** Moves the app's injected clock forward (see `offsetClock`). */
  advanceTime?: (ms: number) => void;
};

/** A private-range client address per scenario, so per-IP limits never carry over. */
export const scenarioAddress = (index: number) =>
  `10.77.${String(Math.floor(index / 250) % 250)}.${String((index % 250) + 1)}`;

/**
 * Runs scenarios in-process through Fastify `app.inject` (no socket). Closes the app afterwards.
 * Each scenario scope is a different client IP.
 */
export function injectBackend(
  app: FastifyInstance,
  options: InjectBackendOptions = {},
): ScenarioBackend {
  const from = (remoteAddress?: string): ScenarioBackend => ({
    async send({ method, url, body, headers }: BackendRequest) {
      const response = await app.inject({
        method,
        url,
        ...(headers ? { headers } : {}),
        ...(body === undefined ? {} : { payload: body as object }),
        ...(remoteAddress ? { remoteAddress } : {}),
      });
      const raw = response.headers['set-cookie'];
      const setCookies = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      return {
        status: response.statusCode,
        body: response.body === '' ? null : (response.json() as unknown),
        ...(setCookies.length > 0 ? { setCookies } : {}),
      };
    },
    ...(options.advanceTime ? { advanceTime: options.advanceTime } : {}),
  });

  return {
    ...from(),
    scope: (index) => from(scenarioAddress(index)),
    close: () => app.close(),
  };
}
