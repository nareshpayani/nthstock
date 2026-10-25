import { readFileSync } from 'node:fs';
import { OPENAPI_PATH, routes, toOpenApiPath } from '@nthstock/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { API_VERSION } from '../health/index.js';
import { OPENAPI_CACHE_CONTROL, openApiText } from './routes.js';

const COMMITTED = new URL('../../../../../docs/api/openapi.json', import.meta.url);

describe(`GET ${OPENAPI_PATH} (T-236)`, () => {
  const app = buildApp({ orderSweepMs: null });

  afterAll(async () => {
    await app.close();
  });

  it('serves the OpenAPI document without a session, cacheable', async () => {
    const response = await app.inject({ method: 'GET', url: OPENAPI_PATH });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe(OPENAPI_CACHE_CONTROL);
    const doc = response.json<{ openapi: string; info: { version: string }; paths: object }>();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe(API_VERSION);
    expect(Object.keys(doc.paths)).toContain(toOpenApiPath(routes.orderPlace.path));
  });

  it('returns exactly what npm run openapi writes', async () => {
    const response = await app.inject({ method: 'GET', url: OPENAPI_PATH });

    expect(response.body).toBe(openApiText());
  });

  it('answers 304 to a revalidation with the same ETag', async () => {
    const first = await app.inject({ method: 'GET', url: OPENAPI_PATH });
    const etag = first.headers['etag'];
    expect(etag).toMatch(/^"[\w-]+"$/);

    const again = await app.inject({
      method: 'GET',
      url: OPENAPI_PATH,
      headers: { 'if-none-match': String(etag) },
    });

    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  // T-237: the committed copy must follow the contracts. CI also regenerates it and diffs.
  it('matches the committed docs/api/openapi.json (run `npm run openapi` after a contract change)', () => {
    expect(readFileSync(COMMITTED, 'utf8')).toBe(openApiText());
  });
});
