import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({ port: 4000, host: '0.0.0.0', mockMarketAlwaysOpen: false });
  });

  it('reads every variable', () => {
    expect(
      loadConfig({ PORT: '8080', HOST: '127.0.0.1', MOCK_MARKET_ALWAYS_OPEN: 'true' }),
    ).toEqual({ port: 8080, host: '127.0.0.1', mockMarketAlwaysOpen: true });
    expect(loadConfig({ MOCK_MARKET_ALWAYS_OPEN: '0' }).mockMarketAlwaysOpen).toBe(false);
  });

  it('fails fast on a bad value', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/Invalid apps\/api environment/);
    expect(() => loadConfig({ MOCK_MARKET_ALWAYS_OPEN: 'yes' })).toThrow(/MOCK_MARKET_ALWAYS_OPEN/);
  });
});
