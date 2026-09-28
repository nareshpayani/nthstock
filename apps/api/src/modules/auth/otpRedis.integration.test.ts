import { DEV_OTP, OtpRequestResponse, routes } from '@nthstock/contracts';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys, mobileHash } from '../../db/crypto.js';
import { PRE_SESSION_CSRF } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import { describeWithPostgresAndRedis } from '../../test/postgresRedisApp.js';

// OTP challenges in Redis behind apps/api on DB_DRIVER=postgres (T-193): any instance sharing
// Redis sees the same challenge and throttle, and nothing in Redis names the mobile.

const MOBILE = '9876543210';
const hash = mobileHash(createPiiCrypto(devPiiKeys()), MOBILE).toString('hex');

describeWithPostgresAndRedis('OTPs in Redis (integration, T-193)', ({ app, redis, prefix }) => {
  const request = (instance: ReturnType<typeof app>) =>
    instance.inject({
      method: 'POST',
      url: routes.otpRequest.path,
      headers: PRE_SESSION_CSRF,
      payload: { mobile: MOBILE },
    });

  it('requests on one instance, is throttled and verified on another', async () => {
    const clock = manualClock();
    const a = app({ deps: { clock } });
    const b = app({ deps: { clock } });

    const requested = await request(a);
    expect(requested.statusCode).toBe(200);
    const { requestId } = OtpRequestResponse.parse(requested.json());
    expect((await redis().keys(`${prefix()}*`)).toSorted()).toEqual(
      [`${prefix()}otp:${hash}`, `${prefix()}otp:resend:${hash}`].toSorted(),
    );

    // The resend throttle holds across instances.
    expect((await request(b)).statusCode).toBe(429);

    // A wrong OTP on A counts on B's view too.
    const wrong = await a.inject({
      method: 'POST',
      url: routes.otpVerify.path,
      headers: PRE_SESSION_CSRF,
      payload: { requestId, mobile: MOBILE, otp: '000000' },
    });
    expect(wrong.json()).toMatchObject({
      error: { code: 'OTP_INVALID', details: { attemptsLeft: 4 } },
    });
    expect(await redis().hget(`${prefix()}otp:${hash}`, 'failures')).toBe('1');

    const verified = await b.inject({
      method: 'POST',
      url: routes.otpVerify.path,
      headers: PRE_SESSION_CSRF,
      payload: { requestId, mobile: MOBILE, otp: DEV_OTP },
    });
    expect(verified.statusCode).toBe(200);
    // Consumed: the challenge is gone from Redis, and it cannot log in twice.
    expect(await redis().exists(`${prefix()}otp:${hash}`)).toBe(0);
    const again = await a.inject({
      method: 'POST',
      url: routes.otpVerify.path,
      headers: PRE_SESSION_CSRF,
      payload: { requestId, mobile: MOBILE, otp: DEV_OTP },
    });
    expect(again.json()).toMatchObject({ error: { code: 'OTP_EXPIRED' } });

    for (const key of await redis().keys(`${prefix()}*`)) expect(key).not.toContain(MOBILE);
  });
});
