import { expect, test } from '@playwright/test';
import { API_ORIGIN, API_TAG, E2E_MODE } from './support/env';

// T-173: the preview server sends the SPA's security headers, the app runs under its CSP with no
// violation, and (api mode) apps/api sends its own on /v1/health.

test(`the preview server sends CSP, X-Frame-Options DENY and nosniff ${API_TAG}`, async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto('/dashboard');
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  // Local preview is plain HTTP: no HSTS.
  expect(headers['strict-transport-security']).toBeUndefined();
  await expect(page.getByRole('banner')).toBeVisible();
  // Live prices tick and the lazy chunks load, all under the policy.
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  expect(violations).toEqual([]);
});

test(`apps/api sends its headers on /v1/health ${API_TAG}`, async ({ request }) => {
  test.skip(E2E_MODE !== 'api', 'apps/api runs in api mode only');
  const response = await request.get(`${API_ORIGIN}/v1/health`);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("default-src 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['strict-transport-security']).toBeUndefined();
});
