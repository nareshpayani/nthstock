import {
  AuthErrorDetails,
  DEV_CAPTCHA_TOKEN,
  DEV_OTP,
  OTP_RESEND_AFTER_SEC,
  OTP_TTL_SEC,
} from '@nthstock/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiHttpError } from '../../http/apiError.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo } from '../audit/repo.js';
import { createMemoryUsersRepo } from '../users/repo.js';
import { createMockCaptchaVerifier } from './captcha.js';
import { createOtpService, type OtpService } from './otpService.js';
import { createMemoryAuthRepo } from './repo.js';
import { createMockSmsProvider } from './smsProvider.js';

const MOBILE = '9876543210';

let clock: ManualClock;
let lines: string[];
let service: OtpService;

function build(production = false) {
  clock = manualClock();
  lines = [];
  let n = 0;
  service = createOtpService({
    clock,
    repo: createMemoryAuthRepo(),
    users: createMemoryUsersRepo({ clock }),
    audit: createMemoryAuditRepo({ clock }),
    sms: createMockSmsProvider({ log: (line) => lines.push(line), production }),
    captcha: createMockCaptchaVerifier({ production }),
    production,
    newRequestId: () => `otp_${String(++n)}`,
    randomOtp: () => '654321',
  });
}

/** Runs `run` and returns the ApiHttpError it throws. */
async function failure(run: () => Promise<unknown>): Promise<ApiHttpError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiHttpError) return error;
    throw error;
  }
  throw new Error('expected an ApiHttpError');
}

const details = (error: ApiHttpError) => AuthErrorDetails.parse(error.details);

beforeEach(() => {
  build();
});

describe('OTP request', () => {
  it('issues a request id and logs the dev OTP through the mock SMS provider', async () => {
    const response = await service.request({ mobile: MOBILE, purpose: 'LOGIN' });

    expect(response).toEqual({
      requestId: 'otp_1',
      resendAfterSec: OTP_RESEND_AFTER_SEC,
      expiresAt: new Date(clock.now().getTime() + OTP_TTL_SEC * 1000).toISOString(),
    });
    expect(lines).toEqual([`[mock-sms] LOGIN OTP for ******3210: ${DEV_OTP}`]);
  });

  it('answers a resend within 30 s with 429 and the seconds left', async () => {
    await service.request({ mobile: MOBILE, purpose: 'LOGIN' });
    clock.advance(29_000);

    const error = await failure(() => service.request({ mobile: MOBILE, purpose: 'LOGIN' }));

    expect(error.status).toBe(429);
    expect(error.code).toBe('RATE_LIMITED');
    expect(details(error).retryAfterSec).toBe(1);
    expect(lines).toHaveLength(1);
  });

  it('allows a resend after 30 s and only the newest OTP works', async () => {
    const first = await service.request({ mobile: MOBILE, purpose: 'LOGIN' });
    clock.advance(30_000);
    const second = await service.request({ mobile: MOBILE, purpose: 'LOGIN' });

    const stale = await failure(() =>
      service.verify({ requestId: first.requestId, mobile: MOBILE, otp: DEV_OTP }),
    );
    expect(stale.code).toBe('OTP_EXPIRED');
    await expect(
      service.verify({ requestId: second.requestId, mobile: MOBILE, otp: DEV_OTP }),
    ).resolves.toEqual({ mobile: MOBILE, purpose: 'LOGIN' });
  });

  it('throttles per mobile, not globally', async () => {
    await service.request({ mobile: MOBILE, purpose: 'LOGIN' });
    await expect(
      service.request({ mobile: '9123456789', purpose: 'LOGIN' }),
    ).resolves.toMatchObject({ requestId: 'otp_2' });
  });

  it('uses a random OTP in production and never writes it to the log', async () => {
    build(true);
    const { requestId } = await service.request({ mobile: MOBILE, purpose: 'UNLOCK_PIN' });

    expect(lines).toEqual(['[mock-sms] UNLOCK_PIN OTP for ******3210: (withheld in production)']);
    expect(
      (await failure(() => service.verify({ requestId, mobile: MOBILE, otp: DEV_OTP }))).code,
    ).toBe('OTP_INVALID');
    await expect(service.verify({ requestId, mobile: MOBILE, otp: '654321' })).resolves.toEqual({
      mobile: MOBILE,
      purpose: 'UNLOCK_PIN',
    });
  });
});

describe('OTP verify', () => {
  let requestId: string;

  beforeEach(async () => {
    ({ requestId } = await service.request({ mobile: MOBILE, purpose: 'LOGIN' }));
  });

  const wrong = () => service.verify({ requestId, mobile: MOBILE, otp: '000000' });

  it('accepts the dev OTP once', async () => {
    await expect(service.verify({ requestId, mobile: MOBILE, otp: DEV_OTP })).resolves.toEqual({
      mobile: MOBILE,
      purpose: 'LOGIN',
    });
    expect(
      (await failure(() => service.verify({ requestId, mobile: MOBILE, otp: DEV_OTP }))).code,
    ).toBe('OTP_EXPIRED');
  });

  it('sets captchaRequired on the 3rd wrong OTP', async () => {
    const first = await failure(wrong);
    const second = await failure(wrong);
    const third = await failure(wrong);

    expect([first, second, third].map((e) => [e.status, e.code])).toEqual([
      [400, 'OTP_INVALID'],
      [400, 'OTP_INVALID'],
      [400, 'OTP_INVALID'],
    ]);
    expect(details(first)).toEqual({ attemptsLeft: 4, captchaRequired: false });
    expect(details(second)).toEqual({ attemptsLeft: 3, captchaRequired: false });
    expect(details(third)).toEqual({ attemptsLeft: 2, captchaRequired: true });
  });

  it('then refuses even the right OTP without a valid CAPTCHA token', async () => {
    for (let i = 0; i < 3; i += 1) await failure(wrong);

    for (const captchaToken of [undefined, 'forged']) {
      const error = await failure(() =>
        service.verify({
          requestId,
          mobile: MOBILE,
          otp: DEV_OTP,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      );
      expect(error.code).toBe('CAPTCHA_REQUIRED');
      expect(details(error)).toEqual({ captchaRequired: true, attemptsLeft: 2 });
    }

    await expect(
      service.verify({ requestId, mobile: MOBILE, otp: DEV_OTP, captchaToken: DEV_CAPTCHA_TOKEN }),
    ).resolves.toMatchObject({ mobile: MOBILE });
  });

  it('burns the OTP after 5 wrong attempts', async () => {
    const captchaToken = DEV_CAPTCHA_TOKEN;
    for (let i = 0; i < 3; i += 1) await failure(wrong);
    await failure(() => service.verify({ requestId, mobile: MOBILE, otp: '000000', captchaToken }));
    const fifth = await failure(() =>
      service.verify({ requestId, mobile: MOBILE, otp: '000000', captchaToken }),
    );
    expect(fifth.code).toBe('OTP_INVALID');
    expect(details(fifth).attemptsLeft).toBe(0);

    const after = await failure(() =>
      service.verify({ requestId, mobile: MOBILE, otp: DEV_OTP, captchaToken }),
    );
    expect(after.code).toBe('OTP_EXPIRED');
  });

  it('rejects an expired OTP, another mobile or an unknown request id', async () => {
    const otherMobile = await failure(() =>
      service.verify({ requestId, mobile: '9123456789', otp: DEV_OTP }),
    );
    const unknownId = await failure(() =>
      service.verify({ requestId: 'otp_x', mobile: MOBILE, otp: DEV_OTP }),
    );
    clock.advance(OTP_TTL_SEC * 1000);
    const late = await failure(() => service.verify({ requestId, mobile: MOBILE, otp: DEV_OTP }));

    expect([otherMobile.code, unknownId.code, late.code]).toEqual([
      'OTP_EXPIRED',
      'OTP_EXPIRED',
      'OTP_EXPIRED',
    ]);
  });

  it('never accepts the dev CAPTCHA token in production', async () => {
    build(true);
    ({ requestId } = await service.request({ mobile: MOBILE, purpose: 'LOGIN' }));
    for (let i = 0; i < 3; i += 1) await failure(wrong);

    const error = await failure(() =>
      service.verify({ requestId, mobile: MOBILE, otp: '654321', captchaToken: DEV_CAPTCHA_TOKEN }),
    );
    expect(error.code).toBe('CAPTCHA_REQUIRED');
  });
});
