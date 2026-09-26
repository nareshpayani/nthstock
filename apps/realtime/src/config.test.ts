import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      port: 8081,
      host: '0.0.0.0',
      redisUrl: 'redis://127.0.0.1:6379',
    });
  });

  it('reads every variable', () => {
    expect(
      loadConfig({ PORT: '9000', HOST: '127.0.0.1', REDIS_URL: 'redis://redis.local:6380' }),
    ).toEqual({ port: 9000, host: '127.0.0.1', redisUrl: 'redis://redis.local:6380' });
  });

  it('fails fast on a bad value', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/Invalid apps\/realtime environment/);
    expect(() => loadConfig({ REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
  });
});
