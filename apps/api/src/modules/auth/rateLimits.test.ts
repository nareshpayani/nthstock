import { ApiError, routes } from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { PRE_SESSION_CSRF } from '../../test/authFlow.js';
import { describeWithRedis, startTestRedis, type TestRedis } from '../../test/testRedis.js';
import { AUTH_RATE_LIMITS } from './rateLimits.js';

const apps: App[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function start(options: Parameters<typeof buildApp>[0] = {}): App {
  const app = buildApp(options);
  apps.push(app);
  return app;
}

/** A distinct mobile per call, so the per-mobile resend throttle never answers first. */
const mobileFor = (n: number) => `98${String(n).padStart(8, '0')}`;

const requestOtp = (app: App, n: number, remoteAddress: string) =>
  app.inject({
    method: 'POST',
    url: routes.otpRequest.path,
    headers: PRE_SESSION_CSRF,
    remoteAddress,
    payload: { mobile: mobileFor(n) },
  });

describe('per-IP limits on auth routes', () => {
  it('answers the 21st OTP request in a minute from one IP with 429', async () => {
    const app = start();
    expect(AUTH_RATE_LIMITS.otpRequest).toBe(20);

    for (let n = 1; n <= 20; n += 1) {
      expect((await requestOtp(app, n, '203.0.113.7')).statusCode).toBe(200);
    }
    const blocked = await requestOtp(app, 21, '203.0.113.7');

    expect(blocked.statusCode).toBe(429);
    expect(ApiError.parse(blocked.json()).error.code).toBe('RATE_LIMITED');
    // Another client is unaffected.
    expect((await requestOtp(app, 22, '203.0.113.8')).statusCode).toBe(200);
  });

  it('limits OTP verify per IP too, independently of OTP requests', async () => {
    const app = start();
    const verify = () =>
      app.inject({
        method: 'POST',
        url: routes.otpVerify.path,
        headers: PRE_SESSION_CSRF,
        remoteAddress: '203.0.113.9',
        payload: { requestId: 'otp_x', mobile: mobileFor(1), otp: '000000' },
      });

    for (let i = 0; i < AUTH_RATE_LIMITS.otpVerify; i += 1) {
      expect((await verify()).statusCode).toBe(400);
    }
    expect((await verify()).statusCode).toBe(429);
    expect((await requestOtp(app, 1, '203.0.113.9')).statusCode).toBe(200);
  });
});

describeWithRedis('per-IP auth limits shared through Redis (integration)', () => {
  let redis: TestRedis;
  const clients: Redis[] = [];

  beforeAll(async () => {
    redis = await startTestRedis();
  }, 120_000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.quit()));
    await redis.stop();
  });

  it('counts requests to every API instance against one limit', async () => {
    const client = (): Redis => {
      const created = new Redis(redis.url, { maxRetriesPerRequest: 1 });
      clients.push(created);
      return created;
    };
    const a = start({ rateLimitRedis: client() });
    const b = start({ rateLimitRedis: client() });
    // A fresh address per run, so counters left in a shared Redis by a rerun cannot interfere.
    const ip = `10.${String(Math.floor(Math.random() * 250))}.${String(process.pid % 250)}.1`;

    for (let n = 1; n <= 20; n += 1) {
      expect((await requestOtp(n % 2 === 0 ? a : b, n, ip)).statusCode).toBe(200);
    }

    expect((await requestOtp(a, 21, ip)).statusCode).toBe(429);
    expect((await requestOtp(b, 22, ip)).statusCode).toBe(429);
  });
});
