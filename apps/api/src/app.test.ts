import { TICKS_CHANNEL } from '@nthstock/contracts';
import { generateSymbolMaster, MockMarketDataAdapter } from '@nthstock/marketData';
import { fixedClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_PER_MINUTE, buildApp } from './app.js';
import { createMemoryPublisher } from './ticks/publisher.js';

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

describe('buildApp tick publishing', () => {
  it('starts publishing adapter ticks when ready and closes the publisher on close', async () => {
    const market = new MockMarketDataAdapter({
      master: generateSymbolMaster({ equityCount: 60 }),
      clock: fixedClock('2026-09-25T05:00:00.000Z'),
      alwaysOpen: true,
      scheduler: { setInterval: () => 0, clearInterval: () => undefined },
    });
    const tickPublisher = createMemoryPublisher();
    const app = buildApp({ deps: { market }, tickPublisher });
    await app.ready();
    market.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(tickPublisher.messages.length).toBeGreaterThan(0);
    expect(tickPublisher.messages[0]?.channel).toBe(TICKS_CHANNEL);
    await app.close();
    expect(tickPublisher.closed).toBe(true);
    const published = tickPublisher.messages.length;
    market.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(tickPublisher.messages).toHaveLength(published);
    market.dispose();
  });
});
