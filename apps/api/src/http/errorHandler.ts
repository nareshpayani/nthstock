import type { FastifyError, FastifyInstance } from 'fastify';
import { ApiHttpError, apiErrorBody, codeForStatus } from './apiError.js';

const INTERNAL_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Makes every error and unknown route answer with the ApiError envelope (T-058):
 * - `ApiHttpError` keeps its status, code, message and details;
 * - framework 4xx errors (malformed JSON, body too large, wrong content type) keep their status;
 * - anything else is logged and becomes a 500 INTERNAL_ERROR without leaking internals.
 */
export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiHttpError, request, reply) => {
    if (error instanceof ApiHttpError) {
      return reply
        .status(error.status)
        .send(apiErrorBody(error.code, error.message, error.details));
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.status(status).send(apiErrorBody(codeForStatus(status), error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(apiErrorBody('INTERNAL_ERROR', INTERNAL_MESSAGE));
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .send(
        apiErrorBody('NOT_FOUND', `Route ${request.method} ${request.url.split('?')[0]} not found`),
      ),
  );
}
