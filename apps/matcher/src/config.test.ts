import { describe, expect, it } from 'vitest';
import { DEFAULT_REDIS_URL, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults to one shard on the local Redis', () => {
    expect(loadConfig({})).toEqual({
      production: false,
      redisUrl: DEFAULT_REDIS_URL,
      shards: 1,
      shard: 0,
      leaseTtlMs: 5_000,
      leaseRenewMs: 2_000,
      alwaysOpen: false,
      databaseUrl: null,
    });
  });

  it('reads the shard, the lease timings and the demo flag', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://cache.internal:6380',
        SHARDS: '4',
        SHARD: '3',
        LEASE_TTL_MS: '6000',
        LEASE_RENEW_MS: '1500',
        MOCK_MARKET_ALWAYS_OPEN: 'true',
        DATABASE_URL: 'postgres://nthstock_app@db.internal:5432/nthstock',
      }),
    ).toEqual({
      production: true,
      redisUrl: 'rediss://cache.internal:6380',
      shards: 4,
      shard: 3,
      leaseTtlMs: 6_000,
      leaseRenewMs: 1_500,
      alwaysOpen: true,
      databaseUrl: 'postgres://nthstock_app@db.internal:5432/nthstock',
    });
  });

  it('refuses a DATABASE_URL that is not Postgres', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://db/x' })).toThrow(/postgres:\/\//);
  });

  it('refuses a shard outside the shard count', () => {
    expect(() => loadConfig({ SHARDS: '2', SHARD: '2' })).toThrow(/SHARD must be below SHARDS/);
  });

  it('refuses a renewal slower than half the lease', () => {
    expect(() => loadConfig({ LEASE_TTL_MS: '3000', LEASE_RENEW_MS: '2000' })).toThrow(
      /LEASE_RENEW_MS/,
    );
  });

  it('refuses a Redis URL that is not redis://', () => {
    expect(() => loadConfig({ REDIS_URL: 'http://localhost' })).toThrow(/REDIS_URL/);
  });
});
