import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_PER_MINUTE, buildApp } from './app.js';

describe('buildApp rate limiting', () => {
  it('answers 429 RATE_LIMITED once a client IP goes over its per-minute limit', async () => {
    const app = buildApp({ rateLimitPerMinute: 2 });
    try {
      const hit = () => app.inject({ method: 'GET', url: '/v1/health' });
      expect((await hit()).statusCode).toBe(200);
      expect((await hit()).statusCode).toBe(200);
      const limited = await hit();
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    } finally {
      await app.close();
    }
  });

  it('defaults to a limit high enough for normal use', () => {
    expect(DEFAULT_RATE_LIMIT_PER_MINUTE).toBeGreaterThanOrEqual(100);
  });
});
