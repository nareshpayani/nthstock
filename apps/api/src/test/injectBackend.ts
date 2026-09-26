import type { ScenarioBackend } from '@nthstock/contracts/testing';
import type { FastifyInstance } from 'fastify';

/** Runs scenarios in-process through Fastify `app.inject` (no socket). Closes the app afterwards. */
export function injectBackend(app: FastifyInstance): ScenarioBackend {
  return {
    async send({ method, url, body }) {
      const response = await app.inject(
        body === undefined ? { method, url } : { method, url, payload: body as object },
      );
      return {
        status: response.statusCode,
        body: response.body === '' ? null : (response.json() as unknown),
      };
    },
    close: () => app.close(),
  };
}
