import { AUTH_COOKIES, ApiError, routes } from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { PRE_SESSION_CSRF, cookieHeader, csrfHeader, loginWithOtp } from '../test/authFlow.js';

let app: App;

beforeEach(() => {
  app = buildApp();
});

afterEach(async () => {
  await app.close();
});

const forbidden = (response: { statusCode: number; json(): unknown }) => {
  expect(response.statusCode).toBe(403);
  expect(ApiError.parse(response.json()).error.code).toBe('FORBIDDEN');
};

describe('CSRF check', () => {
  it('answers a POST without the CSRF header with 403, before validating the body', async () => {
    forbidden(
      await app.inject({
        method: 'POST',
        url: routes.otpRequest.path,
        payload: { mobile: '9876543210' },
      }),
    );
    forbidden(
      await app.inject({ method: 'POST', url: routes.otpRequest.path, payload: { mobile: 'x' } }),
    );
  });

  it('refuses an empty or oversized header', async () => {
    for (const value of ['', '   ', 'x'.repeat(257)]) {
      forbidden(
        await app.inject({
          method: 'POST',
          url: routes.otpRequest.path,
          headers: { 'x-csrf-token': value },
          payload: { mobile: '9876543210' },
        }),
      );
    }
  });

  it('leaves GETs alone and accepts any header value before a session exists', async () => {
    expect((await app.inject({ method: 'GET', url: routes.health.path })).statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: routes.otpRequest.path,
      headers: PRE_SESSION_CSRF,
      payload: { mobile: '9876543210' },
    });
    expect(response.statusCode).toBe(200);
  });

  it("with a session cookie, requires the session's own CSRF token", async () => {
    const { access, csrf } = await loginWithOtp(app, '9876543210');
    const logout = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: routes.logout.path,
        headers: { cookie: cookieHeader({ [AUTH_COOKIES.access]: access }), ...headers },
      });

    forbidden(await logout({}));
    forbidden(await logout(PRE_SESSION_CSRF));
    forbidden(await logout(csrfHeader(`${csrf}x`)));
    expect((await logout(csrfHeader(csrf))).statusCode).toBe(200);
  });

  it('with a Bearer token (never sent by the browser on its own), any header value will do', async () => {
    const { access } = await loginWithOtp(app, '9876543210');

    const response = await app.inject({
      method: 'POST',
      url: routes.logout.path,
      headers: { authorization: `Bearer ${access}`, ...PRE_SESSION_CSRF },
    });

    expect(response.statusCode).toBe(200);
  });
});
