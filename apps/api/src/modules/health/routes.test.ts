import { HealthResponse } from '@nthstock/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { API_VERSION } from './routes.js';

describe('GET /v1/health', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('returns a schema-valid ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = HealthResponse.parse(response.json());
    expect(body).toMatchObject({ status: 'ok', version: API_VERSION });
  });
});
