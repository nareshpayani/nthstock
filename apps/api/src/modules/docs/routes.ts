import { createHash } from 'node:crypto';
import { OPENAPI_PATH, renderOpenApiDocument } from '@nthstock/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { API_VERSION } from '../health/index.js';

/** The OpenAPI document this build serves and `npm run openapi` writes (T-236). */
export const openApiText = (): string => renderOpenApiDocument({ version: API_VERSION });

/** Clients and CDNs may keep it for an hour; the ETag makes a revalidation a 304. */
export const OPENAPI_CACHE_CONTROL = 'public, max-age=3600';

/**
 * `GET /v1/docs/openapi.json` (T-236): the generated OpenAPI 3.1 document, public and cacheable.
 * It sits outside the route map on purpose (spec backend-core §11): it describes the map.
 */
export const docsRoutes = (): FastifyPluginAsync => async (app) => {
  // Built once per process: the route map cannot change while it runs.
  const text = openApiText();
  const etag = `"${createHash('sha256').update(text).digest('base64url').slice(0, 27)}"`;

  app.get(OPENAPI_PATH, async (request, reply) => {
    reply.header('cache-control', OPENAPI_CACHE_CONTROL).header('etag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(text);
  });
};
