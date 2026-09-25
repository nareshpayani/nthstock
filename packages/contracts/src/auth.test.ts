import { describe, expect, it } from 'vitest';
import {
  Device,
  Mobile,
  Otp,
  OtpRequest,
  OtpRequestResponse,
  OtpVerifyRequest,
  Pin,
  PinSetRequest,
  PinSetResponse,
  PinVerifyRequest,
  Session,
  User,
} from './auth.js';
import {
  deviceFixture,
  otpRequestResponseFixture,
  otpVerifyFixture,
  pinSetFixture,
  sessionFixture,
  userFixture,
} from './fixtures.js';

describe('auth fixtures round-trip', () => {
  it.each([
    ['OtpRequestResponse', OtpRequestResponse, otpRequestResponseFixture],
    ['OtpVerifyRequest', OtpVerifyRequest, otpVerifyFixture],
    ['PinSetRequest', PinSetRequest, pinSetFixture],
    ['PinSetResponse', PinSetResponse, { device: deviceFixture }],
    ['PinVerifyRequest', PinVerifyRequest, { pin: '482105' }],
    ['User', User, userFixture],
    ['Device', Device, deviceFixture],
    ['Session', Session, sessionFixture],
  ] as const)('%s', (_name, schema, fixture) => {
    expect(schema.parse(fixture)).toEqual(fixture);
  });
});

describe('Mobile', () => {
  it('accepts 10-digit numbers starting 6–9', () => {
    for (const mobile of ['6000000000', '7123456789', '8999999999', '9876543210']) {
      expect(Mobile.parse(mobile)).toBe(mobile);
    }
  });

  it('rejects other starts, lengths and formats', () => {
    for (const mobile of [
      '5876543210',
      '0987654321',
      '987654321',
      '98765432101',
      '+919876543210',
      '98765 43210',
    ]) {
      expect(Mobile.safeParse(mobile).success).toBe(false);
    }
  });
});

describe('Otp', () => {
  it('accepts exactly 6 digits', () => {
    expect(Otp.parse('012345')).toBe('012345');
    for (const otp of ['12345', '1234567', '12a456', '']) {
      expect(Otp.safeParse(otp).success).toBe(false);
    }
  });
});

describe('Pin', () => {
  it('accepts 4 to 6 digits', () => {
    for (const pin of ['0000', '12345', '123456']) {
      expect(Pin.parse(pin)).toBe(pin);
    }
    for (const pin of ['123', '1234567', '12a4']) {
      expect(Pin.safeParse(pin).success).toBe(false);
    }
  });

  it('requires the confirmation to match when setting a PIN', () => {
    const result = PinSetRequest.safeParse({ pin: '1234', confirmPin: '4321' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPin']);
  });
});

describe('OtpRequest', () => {
  it('defaults the purpose to LOGIN', () => {
    expect(OtpRequest.parse({ mobile: '9876543210' })).toEqual({
      mobile: '9876543210',
      purpose: 'LOGIN',
    });
    expect(OtpRequest.parse({ mobile: '9876543210', purpose: 'UNLOCK_PIN' }).purpose).toBe(
      'UNLOCK_PIN',
    );
  });
});

describe('User', () => {
  it('only carries a masked mobile', () => {
    expect(User.safeParse({ ...userFixture, mobileMasked: '9876543210' }).success).toBe(false);
  });
});
