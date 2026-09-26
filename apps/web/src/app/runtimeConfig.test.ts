// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RuntimeConfigError,
  parseRuntimeConfig,
  resolveWsUrl,
  runtimeEnvSchema,
} from './runtimeConfig';

describe('parseRuntimeConfig', () => {
  it('defaults to msw mode, same-origin REST and a derived WS URL', () => {
    expect(parseRuntimeConfig({})).toEqual({
      apiMode: 'msw',
      apiBaseUrl: '',
      wsUrl: null,
      mockMarketOpen: false,
    });
    expect(
      parseRuntimeConfig({ VITE_API_MODE: '', VITE_API_BASE_URL: ' ', VITE_MOCK_MARKET_OPEN: '' }),
    ).toMatchObject({ apiMode: 'msw', apiBaseUrl: '', mockMarketOpen: false });
  });

  it('reads api mode, URLs and the market-open flag', () => {
    expect(
      parseRuntimeConfig({
        VITE_API_MODE: 'api',
        VITE_API_BASE_URL: 'https://api.nthstock.test/',
        VITE_WS_URL: 'wss://rt.nthstock.test/ws',
        VITE_MOCK_MARKET_OPEN: 'true',
      }),
    ).toEqual({
      apiMode: 'api',
      apiBaseUrl: 'https://api.nthstock.test',
      wsUrl: 'wss://rt.nthstock.test/ws',
      mockMarketOpen: true,
    });
    expect(parseRuntimeConfig({ VITE_MOCK_MARKET_OPEN: '1' }).mockMarketOpen).toBe(true);
    expect(parseRuntimeConfig({ VITE_MOCK_MARKET_OPEN: '0' }).mockMarketOpen).toBe(false);
  });

  it('fails fast on an invalid mode', () => {
    expect(() => parseRuntimeConfig({ VITE_API_MODE: 'mock' })).toThrow(RuntimeConfigError);
    expect(() => parseRuntimeConfig({ VITE_API_MODE: 'mock' })).toThrow(
      /VITE_API_MODE must be one of: msw, api/,
    );
  });

  it('rejects malformed URLs and flags', () => {
    expect(() => parseRuntimeConfig({ VITE_API_BASE_URL: 'ftp://x.test' })).toThrow(
      /VITE_API_BASE_URL/,
    );
    expect(() => parseRuntimeConfig({ VITE_API_BASE_URL: 'https://x.test/v1' })).toThrow(
      /must not end in \/v1/,
    );
    expect(() => parseRuntimeConfig({ VITE_WS_URL: 'https://x.test/ws' })).toThrow(/VITE_WS_URL/);
    expect(() => parseRuntimeConfig({ VITE_MOCK_MARKET_OPEN: 'yes' })).toThrow(
      /VITE_MOCK_MARKET_OPEN must be true or false/,
    );
  });
});

describe('resolveWsUrl', () => {
  it('uses the configured URL, else /ws on the page host with the matching scheme', () => {
    expect(resolveWsUrl({ wsUrl: 'wss://rt.test/ws' }, { protocol: 'http:', host: 'x' })).toBe(
      'wss://rt.test/ws',
    );
    expect(resolveWsUrl({ wsUrl: null }, { protocol: 'http:', host: '127.0.0.1:4173' })).toBe(
      'ws://127.0.0.1:4173/ws',
    );
    expect(resolveWsUrl({ wsUrl: null }, { protocol: 'https:', host: 'nthstock.in' })).toBe(
      'wss://nthstock.in/ws',
    );
  });
});

describe('.env.example', () => {
  const text = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  const entries = text
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => line.split('=') as [string, string]);

  it('lists every variable the config reads, and nothing else', () => {
    expect(entries.map(([key]) => key).sort()).toEqual(Object.keys(runtimeEnvSchema.shape).sort());
  });

  it('holds only defaults, no secret values, and parses', () => {
    for (const [, value] of entries) expect(value).toMatch(/^(msw|api|true|false|)$/);
    expect(() => parseRuntimeConfig(Object.fromEntries(entries))).not.toThrow();
  });
});
