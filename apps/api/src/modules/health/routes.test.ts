import { ApiError, HealthResponse, ReadyResponse } from '@nthstock/contracts';
import { fixedClock } from '@nthstock/utils';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { installErrorHandling } from '../../http/errorHandler.js';
import { API_VERSION, healthRoutes, type ReadinessChecks } from './routes.js';

/** Nothing listens on port 1: Postgres "stopped". */
const STOPPED_POSTGRES = 'postgres://nthstock_app:x@127.0.0.1:1/nthstock';

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

describe('GET /v1/health/ready (T-182)', () => {
  it('is ready with nothing to check on the memory driver without Redis', async () => {
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(ReadyResponse.parse(response.json())).toEqual({
      postgres: 'disabled',
      redis: 'disabled',
    });
    await app.close();
  });

  it('answers 503 when Postgres is stopped', async () => {
    const app = buildApp({
      deps: { dbDriver: 'postgres', databaseUrl: STOPPED_POSTGRES },
      redisReadiness: () => Promise.resolve('PONG'),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(ApiError.parse(response.json()).error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { postgres: 'down', redis: 'up' },
    });
    await app.close();
  });

  it('answers 503 when the Redis check fails', async () => {
    const app = buildApp({ redisReadiness: () => Promise.reject(new Error('ECONNREFUSED')) });

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { details: { postgres: 'disabled', redis: 'down' } },
    });
    await app.close();
  });

  const withChecks = async (readiness: ReadinessChecks) => {
    const app = Fastify();
    installErrorHandling(app);
    await app.register(
      healthRoutes({
        clock: fixedClock('2026-09-25T04:00:00.000Z'),
        readiness,
        readyTimeoutMs: 20,
      }),
    );
    return app;
  };

  it('is ready when every configured check answers', async () => {
    const app = await withChecks({
      postgres: () => Promise.resolve(),
      redis: () => Promise.resolve('PONG'),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ postgres: 'up', redis: 'up' });
    await app.close();
  });

  it('counts a check that never answers as down', async () => {
    const app = await withChecks({ postgres: () => new Promise(() => undefined), redis: null });

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { details: { postgres: 'down', redis: 'disabled' } },
    });
    await app.close();
  });
});
