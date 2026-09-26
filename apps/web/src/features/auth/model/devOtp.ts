import { DEV_OTP } from '@nthstock/contracts';

/**
 * The fixed OTP of the mock backends (MSW and apps/api outside production), shown on the OTP screen
 * so anyone running nthstock locally can log in. Hidden in production api-mode builds, where the
 * OTP is random and this value is never accepted.
 */
export const devOtpHint: string | null =
  import.meta.env.DEV || import.meta.env.VITE_API_MODE !== 'api' ? DEV_OTP : null;
