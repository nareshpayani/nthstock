import { HealthResponse } from '@nthstock/contracts';
import { fixedClock } from '@nthstock/utils';
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

  it('reports the time from the injected clock', async () => {
    const clocked = buildApp({ deps: { clock: fixedClock('2026-09-25T04:00:00.000Z') } });

    const response = await clocked.inject({ method: 'GET', url: '/v1/health' });

    expect(response.json()).toMatchObject({ time: '2026-09-25T04:00:00.000Z' });
    await clocked.close();
  });
});
