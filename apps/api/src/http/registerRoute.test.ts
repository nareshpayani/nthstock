import { ApiError, routes } from '@nthstock/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiHttpError, codeForStatus, notFound } from './apiError.js';
import { installErrorHandling } from './errorHandler.js';
import { registerRoute } from './registerRoute.js';

const OTP_RESPONSE = {
  requestId: 'req_1',
  resendAfterSec: 30,
  expiresAt: '2026-09-25T04:00:00.000Z',
};

let app: FastifyInstance;

function freshApp(): FastifyInstance {
  app = Fastify();
  installErrorHandling(app);
  return app;
}

afterEach(async () => {
  await app.close();
});

const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as string });

describe('registerRoute: request validation', () => {
  it('answers an invalid body with 400 and the ApiError shape', async () => {
    const handler = vi.fn(() => OTP_RESPONSE);
    registerRoute(freshApp(), 'otpRequest', handler);

    const response = await post(routes.otpRequest.path, { mobile: '12345' });

    expect(response.statusCode).toBe(400);
    const body = ApiError.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid body');
    expect(body.error.details?.['issues']).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['mobile'] })]),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers a missing body with 400 VALIDATION_ERROR', async () => {
    registerRoute(freshApp(), 'otpRequest', () => OTP_RESPONSE);

    const response = await app.inject({ method: 'POST', url: routes.otpRequest.path });

    expect(response.statusCode).toBe(400);
    expect(ApiError.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('answers malformed JSON with 400 and the ApiError shape', async () => {
    registerRoute(freshApp(), 'otpRequest', () => OTP_RESPONSE);

    const response = await app.inject({
      method: 'POST',
      url: routes.otpRequest.path,
      headers: { 'content-type': 'application/json' },
      payload: '{"mobile":',
    });

    expect(response.statusCode).toBe(400);
    expect(ApiError.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('passes the parsed body, with schema defaults, to the handler', async () => {
    const handler = vi.fn<(context: { body: unknown }) => typeof OTP_RESPONSE>(() => OTP_RESPONSE);
    registerRoute(freshApp(), 'otpRequest', handler);

    const response = await post(routes.otpRequest.path, { mobile: '9876543210' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(OTP_RESPONSE);
    expect(handler.mock.calls[0]?.[0].body).toEqual({ mobile: '9876543210', purpose: 'LOGIN' });
  });

  it('answers invalid path params with 400', async () => {
    registerRoute(freshApp(), 'marketList', () => notFound('List'));

    const response = await app.inject({ method: 'GET', url: '/v1/market/lists/Not_A_Slug' });

    expect(response.statusCode).toBe(400);
    expect(ApiError.parse(response.json()).error.message).toBe('Invalid path parameters');
  });

  it('answers an invalid query with 400 and coerces a valid one', async () => {
    const handler = vi.fn(({ query }: { query: { index: string } }) => ({
      index: query.index,
      direction: 'gainers' as const,
      items: [],
      asOf: '2026-09-25T04:00:00.000Z',
    }));
    registerRoute(freshApp(), 'marketMovers', handler);

    const bad = await app.inject({ method: 'GET', url: '/v1/market/movers?index=NIFTY50' });
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error.message).toBe('Invalid query');

    const good = await app.inject({
      method: 'GET',
      url: '/v1/market/movers?index=NIFTY50&direction=gainers&limit=5',
    });
    expect(good.statusCode).toBe(200);
    expect(handler.mock.calls[0]?.[0].query).toEqual({
      index: 'NIFTY50',
      direction: 'gainers',
      limit: 5,
    });
  });
});

describe('registerRoute: responses and errors', () => {
  it('turns an ApiHttpError into its status and envelope', async () => {
    registerRoute(freshApp(), 'marketList', ({ params }) => notFound(`List ${params.id}`));

    const response = await app.inject({ method: 'GET', url: '/v1/market/lists/top-it' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'List top-it not found' },
    });
  });

  it('keeps ApiHttpError details', async () => {
    registerRoute(freshApp(), 'marketIndices', () => {
      throw new ApiHttpError(503, 'SERVICE_UNAVAILABLE', 'Feed down', { retryAfterSec: 5 });
    });

    const response = await app.inject({ method: 'GET', url: '/v1/market/indices' });

    expect(response.statusCode).toBe(503);
    expect(ApiError.parse(response.json()).error.details).toEqual({ retryAfterSec: 5 });
  });

  it('answers 500 INTERNAL_ERROR when a handler breaks the response schema', async () => {
    registerRoute(freshApp(), 'marketIndices', () => ({ items: [{ bogus: true }] }) as never);

    const response = await app.inject({ method: 'GET', url: '/v1/market/indices' });

    expect(response.statusCode).toBe(500);
    const body = ApiError.parse(response.json());
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toMatch(/schema|bogus/);
  });

  it('skips response validation when asked', async () => {
    registerRoute(freshApp(), 'marketIndices', () => ({ items: [], extra: 1 }) as never, {
      validateResponse: false,
    });

    const response = await app.inject({ method: 'GET', url: '/v1/market/indices' });

    expect(response.json()).toEqual({ items: [], extra: 1 });
  });

  it('strips fields the response schema does not declare', async () => {
    registerRoute(freshApp(), 'marketIndices', () => ({ items: [], secret: 'x' }) as never);

    const response = await app.inject({ method: 'GET', url: '/v1/market/indices' });

    expect(response.json()).toEqual({ items: [] });
  });

  it('hides unexpected errors behind a 500 INTERNAL_ERROR', async () => {
    registerRoute(freshApp(), 'marketIndices', () => {
      throw new Error('database password is hunter2');
    });

    const response = await app.inject({ method: 'GET', url: '/v1/market/indices' });

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.json())).not.toContain('hunter2');
  });

  it('answers unknown routes with 404 NOT_FOUND', async () => {
    freshApp();

    const response = await app.inject({ method: 'GET', url: '/v1/nope?x=1' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /v1/nope not found' },
    });
  });
});

describe('registerRoute: auth', () => {
  it('refuses to register a user route without an authenticate hook', () => {
    expect(() => registerRoute(freshApp(), 'logout', () => ({ ok: true }))).toThrow(/authenticate/);
  });

  it('runs the authenticate hook before the handler', async () => {
    const handler = vi.fn(() => ({ ok: true as const }));
    registerRoute(freshApp(), 'logout', handler, {
      authenticate: () => {
        throw new ApiHttpError(401, 'UNAUTHORIZED', 'Log in to continue');
      },
    });

    const response = await app.inject({ method: 'POST', url: routes.logout.path });

    expect(response.statusCode).toBe(401);
    expect(ApiError.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('codeForStatus', () => {
  it('maps known statuses and falls back by class', () => {
    expect(codeForStatus(400)).toBe('VALIDATION_ERROR');
    expect(codeForStatus(413)).toBe('VALIDATION_ERROR');
    expect(codeForStatus(429)).toBe('RATE_LIMITED');
    expect(codeForStatus(502)).toBe('INTERNAL_ERROR');
  });
});
