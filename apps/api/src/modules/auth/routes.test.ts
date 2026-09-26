import { ApiError, OtpRequestResponse, routes } from '@nthstock/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { manualClock } from '../../test/manualClock.js';

const clock = manualClock();
let app: App;
let smsLines: string[];

function start() {
  smsLines = [];
  app = buildApp({ deps: { clock, smsLog: (line) => smsLines.push(line) } });
  return app;
}

afterEach(async () => {
  await app.close();
});

const requestOtp = (mobile = '9876543210') =>
  app.inject({ method: 'POST', url: routes.otpRequest.path, payload: { mobile } });

describe('POST /v1/auth/otp/request', () => {
  it('answers with a request id and logs the OTP through the mock SMS provider', async () => {
    start();
    const response = await requestOtp();

    expect(response.statusCode).toBe(200);
    const body = OtpRequestResponse.parse(response.json());
    expect(body.resendAfterSec).toBe(30);
    expect(smsLines).toEqual(['[mock-sms] LOGIN OTP for ******3210: 123456']);
    expect(response.body).not.toContain('123456');
  });

  it('answers a resend within 30 s with 429 RATE_LIMITED', async () => {
    start();
    await requestOtp();
    clock.advance(10_000);

    const response = await requestOtp();

    expect(response.statusCode).toBe(429);
    expect(ApiError.parse(response.json()).error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: 20 },
    });
  });

  it('rejects a malformed mobile with 400', async () => {
    start();
    const response = await requestOtp('12345');
    expect(response.statusCode).toBe(400);
  });
});
