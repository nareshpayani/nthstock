import { describe, expect, it } from 'vitest';
import { routes } from './routes.js';
import {
  TEST_CONTROL_PATHS,
  TestClockRequest,
  TestPriceRequest,
  TestPriceResponse,
} from './testControls.js';

describe('test controls', () => {
  it('live under /v1/__test and never in the public route map', () => {
    for (const path of Object.values(TEST_CONTROL_PATHS)) expect(path).toMatch(/^\/v1\/__test\//);
    for (const def of Object.values(routes)) expect(def.path).not.toContain('__test');
  });

  it('take a UTC instant for the clock', () => {
    expect(TestClockRequest.safeParse({ at: '2026-09-28T04:30:00.000Z' }).success).toBe(true);
    expect(TestClockRequest.safeParse({ at: '2026-09-28 10:00' }).success).toBe(false);
  });

  it('take a symbol and a positive paise price', () => {
    expect(TestPriceRequest.parse({ symbol: 'INFY', ltp: 150_000 })).toEqual({
      symbol: 'INFY',
      ltp: 150_000,
    });
    expect(TestPriceRequest.safeParse({ symbol: 'INFY', ltp: 0 }).success).toBe(false);
    expect(TestPriceRequest.safeParse({ symbol: 'INFY', ltp: 1500.5 }).success).toBe(false);
    expect(TestPriceRequest.safeParse({ symbol: 'infy', ltp: 100 }).success).toBe(false);
    expect(TestPriceResponse.safeParse({ symbol: 'INFY', token: 1, ltp: 5 }).success).toBe(true);
  });
});
