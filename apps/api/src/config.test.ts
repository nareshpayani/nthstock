import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      production: false,
      port: 4000,
      host: '0.0.0.0',
      mockMarketAlwaysOpen: false,
      jwtSecret: undefined,
      redisUrl: null,
    });
    expect(loadConfig({ REDIS_URL: ' ' }).redisUrl).toBeNull();
  });

  it('reads every variable', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'test-only-secret-at-least-32-characters',
        PORT: '8080',
        HOST: '127.0.0.1',
        MOCK_MARKET_ALWAYS_OPEN: 'true',
        REDIS_URL: 'redis://127.0.0.1:6379',
      }),
    ).toEqual({
      production: true,
      port: 8080,
      host: '127.0.0.1',
      mockMarketAlwaysOpen: true,
      jwtSecret: 'test-only-secret-at-least-32-characters',
      redisUrl: 'redis://127.0.0.1:6379',
    });
    expect(loadConfig({ MOCK_MARKET_ALWAYS_OPEN: '0' }).mockMarketAlwaysOpen).toBe(false);
  });

  it('fails fast on a bad value', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/Invalid apps\/api environment/);
    expect(() => loadConfig({ MOCK_MARKET_ALWAYS_OPEN: 'yes' })).toThrow(/MOCK_MARKET_ALWAYS_OPEN/);
    expect(() => loadConfig({ REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET must be set/);
  });
});
