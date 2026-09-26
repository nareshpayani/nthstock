import type { OtpPurpose } from '@nthstock/contracts';
import { maskMobile } from '../users/service.js';

/** Sends OTPs by SMS. A mock until launch (requirements BE-07); a real provider plugs in here. */
export interface SmsProvider {
  sendOtp(message: { mobile: string; otp: string; purpose: OtpPurpose }): Promise<void>;
}

export type SmsLog = (line: string) => void;

/**
 * The mock SMS provider: nothing is sent, the OTP is written to the dev log instead so a developer
 * can log in. This is the only place an OTP is ever logged, and only outside production; in
 * production the line leaves the code out.
 */
export function createMockSmsProvider({
  log,
  production,
}: {
  log: SmsLog;
  production: boolean;
}): SmsProvider {
  return {
    sendOtp({ mobile, otp, purpose }) {
      const code = production ? '(withheld in production)' : otp;
      log(`[mock-sms] ${purpose} OTP for ${maskMobile(mobile)}: ${code}`);
      return Promise.resolve();
    },
  };
}
