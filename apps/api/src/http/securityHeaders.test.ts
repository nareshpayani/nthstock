import { AUTH_COOKIES } from '@nthstock/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { setCookieLine, loginWithOtp } from '../test/authFlow.js';
import { API_CONTENT_SECURITY_POLICY, HSTS_VALUE, apiSecurityHeaders } from './securityHeaders.js';

// T-173: security headers on apps/api, HSTS outside local, and the auth cookie flags.

const TEST_KEY = new Uint8Array(32).fill(7);

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const expectBaseHeaders = (headers: Record<string, unknown>) => {
  expect(headers['content-security-policy']).toBe(API_CONTENT_SECURITY_POLICY);
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
};

describe('security headers', () => {
  it('sends CSP, X-Frame-Options DENY and nosniff on /v1/health, without HSTS locally', async () => {
    app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    expectBaseHeaders(response.headers);
    expect(API_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('adds HSTS outside local (production)', async () => {
    app = buildApp({ deps: { production: true, jwtSecret: TEST_KEY } });
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expectBaseHeaders(response.headers);
    expect(response.headers['strict-transport-security']).toBe(HSTS_VALUE);
  });

  it('keeps the headers on 404s, errors and rate-limited replies', async () => {
    app = buildApp({ rateLimitPerMinute: 1 });
    const missing = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(missing.statusCode).toBe(404);
    expectBaseHeaders(missing.headers);

    const noCsrf = await app.inject({ method: 'POST', url: '/v1/auth/logout' });
    expect(noCsrf.statusCode).toBe(403);
    expectBaseHeaders(noCsrf.headers);
  });

  it('keeps the headers on a 429', async () => {
    app = buildApp({ rateLimitPerMinute: 1 });
    await app.inject({ method: 'GET', url: '/v1/health' });
    const limited = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(limited.statusCode).toBe(429);
    expectBaseHeaders(limited.headers);
  });

  it('lists HSTS only when asked', () => {
    expect(apiSecurityHeaders({ hsts: false })).not.toHaveProperty('strict-transport-security');
    expect(apiSecurityHeaders({ hsts: true })).toHaveProperty(
      'strict-transport-security',
      HSTS_VALUE,
    );
  });
});

describe('auth cookie flags', () => {
  // Secure outside local is covered by modules/auth/sessions.test.ts ("marks cookies Secure").
  it('sets HttpOnly and SameSite=Strict on the session cookies, with the headers', async () => {
    app = buildApp();
    const { response } = await loginWithOtp(app, '9876500001');
    expectBaseHeaders(response.headers);
    for (const name of [AUTH_COOKIES.access, AUTH_COOKIES.refresh]) {
      const line = setCookieLine(response, name) ?? '';
      expect(line).toContain('HttpOnly');
      expect(line).toContain('SameSite=Strict');
      expect(line).not.toContain('Secure');
    }
  });
});
