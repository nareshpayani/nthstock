import { DEV_CAPTCHA_TOKEN } from '@nthstock/contracts';

/** Checks a CAPTCHA token from the client (required after 3 wrong OTPs). */
export interface CaptchaVerifier {
  verify(token: string): Promise<boolean>;
}

/**
 * The mock verifier: outside production it accepts only `DEV_CAPTCHA_TOKEN`; in production it
 * accepts nothing, so a real provider must be wired in before launch (fails closed).
 */
export function createMockCaptchaVerifier({
  production,
}: {
  production: boolean;
}): CaptchaVerifier {
  return {
    verify: (token) => Promise.resolve(!production && token === DEV_CAPTCHA_TOKEN),
  };
}
