import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { devPiiKeys } from './db/crypto.js';

// Test-only PII keys: base64 of 32 fixed bytes each (not secrets).
const ENC_KEY = Buffer.alloc(32, 7).toString('base64');
const HMAC_KEY = Buffer.alloc(32, 9).toString('base64');

describe('loadConfig', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      production: false,
      port: 4000,
      host: '0.0.0.0',
      mockMarketAlwaysOpen: false,
      jwtSecret: undefined,
      redisUrl: null,
      databaseUrl: null,
      pgPoolMax: 10,
      dbDriver: 'memory',
      testControls: false,
      demoSeed: false,
      pii: { keys: devPiiKeys(), devKeys: true },
    });
    expect(loadConfig({ REDIS_URL: ' ' }).redisUrl).toBeNull();
    expect(loadConfig({ DATABASE_URL: ' ' }).databaseUrl).toBeNull();
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
        DATABASE_URL: 'postgres://nthstock_app:pw@127.0.0.1:5432/nthstock',
        PG_POOL_MAX: '20',
        DB_DRIVER: 'postgres',
        PII_ENC_KEYS: `2:${ENC_KEY}`,
        PII_HMAC_KEY: HMAC_KEY,
      }),
    ).toEqual({
      production: true,
      port: 8080,
      host: '127.0.0.1',
      mockMarketAlwaysOpen: true,
      jwtSecret: 'test-only-secret-at-least-32-characters',
      redisUrl: 'redis://127.0.0.1:6379',
      databaseUrl: 'postgres://nthstock_app:pw@127.0.0.1:5432/nthstock',
      pgPoolMax: 20,
      dbDriver: 'postgres',
      testControls: false,
      demoSeed: false,
      pii: {
        keys: {
          encryption: new Map([[2, Buffer.alloc(32, 7)]]),
          currentKeyId: 2,
          hmac: Buffer.alloc(32, 9),
        },
        devKeys: false,
      },
    });
    expect(loadConfig({ MOCK_MARKET_ALWAYS_OPEN: '0' }).mockMarketAlwaysOpen).toBe(false);
  });

  it('turns the test controls on only with NODE_ENV=test and the explicit flag (T-162)', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).testControls).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', ENABLE_TEST_CONTROLS: 'true' }).testControls).toBe(true);
    expect(() => loadConfig({ ENABLE_TEST_CONTROLS: 'true' })).toThrow(/needs NODE_ENV=test/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'test-only-secret-at-least-32-characters',
        ENABLE_TEST_CONTROLS: '1',
      }),
    ).toThrow(/needs NODE_ENV=test \(got production\)/);
  });

  it('loads the demo seed on DEMO_SEED=true, never in production (T-174)', () => {
    expect(loadConfig({ DEMO_SEED: 'true' }).demoSeed).toBe(true);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'test-only-secret-at-least-32-characters',
        DEMO_SEED: 'true',
      }),
    ).toThrow(/DEMO_SEED is for local demos/);
  });

  it('accepts only a postgres:// or postgresql:// DATABASE_URL (T-178)', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://u:p@db:5432/nthstock' }).databaseUrl).toBe(
      'postgresql://u:p@db:5432/nthstock',
    );
    expect(() => loadConfig({ DATABASE_URL: 'mysql://u:p@db:3306/nthstock' })).toThrow(
      /must be a postgres:\/\/ or postgresql:\/\/ URL[\s\S]*DATABASE_URL/,
    );
    expect(() => loadConfig({ DATABASE_URL: 'redis://127.0.0.1:6379' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ PG_POOL_MAX: '0' })).toThrow(/PG_POOL_MAX/);
    expect(() => loadConfig({ PG_POOL_MAX: 'many' })).toThrow(/PG_POOL_MAX/);
  });

  it('picks the storage driver; postgres needs DATABASE_URL and REDIS_URL (T-182, T-193)', () => {
    expect(loadConfig({ DB_DRIVER: 'memory' }).dbDriver).toBe('memory');
    expect(() => loadConfig({ DB_DRIVER: 'postgres' })).toThrow(
      /DB_DRIVER=postgres needs DATABASE_URL/,
    );
    expect(() => loadConfig({ DB_DRIVER: 'sqlite' })).toThrow(/DB_DRIVER/);
    expect(() =>
      loadConfig({ DB_DRIVER: 'postgres', DATABASE_URL: 'postgres://u:p@db:5432/nthstock' }),
    ).toThrow(/DB_DRIVER=postgres needs REDIS_URL/);
  });

  it('refuses to start in production without the PII keys, or with bad ones (T-189)', () => {
    const production = {
      NODE_ENV: 'production',
      JWT_SECRET: 'test-only-secret-at-least-32-characters',
    };
    expect(() => loadConfig(production)).toThrow(
      /Invalid apps\/api environment: PII_ENC_KEYS and PII_HMAC_KEY must be set in production/,
    );
    expect(() => loadConfig({ ...production, PII_ENC_KEYS: `1:${ENC_KEY}` })).toThrow(
      /must be set in production/,
    );
    expect(
      loadConfig({ ...production, PII_ENC_KEYS: `1:${ENC_KEY}`, PII_HMAC_KEY: HMAC_KEY }).pii
        .devKeys,
    ).toBe(false);
    expect(() => loadConfig({ PII_ENC_KEYS: '1:short', PII_HMAC_KEY: HMAC_KEY })).toThrow(
      /PII_ENC_KEYS key 1 must be base64 of exactly 32 bytes/,
    );
  });

  it('fails fast on a bad value', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/Invalid apps\/api environment/);
    expect(() => loadConfig({ MOCK_MARKET_ALWAYS_OPEN: 'yes' })).toThrow(/MOCK_MARKET_ALWAYS_OPEN/);
    expect(() => loadConfig({ REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET must be set/);
  });
});
