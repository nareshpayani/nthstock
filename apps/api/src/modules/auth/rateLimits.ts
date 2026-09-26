import type { RouteName } from '@nthstock/contracts';

/**
 * Per-IP limits on the auth routes (T-082), per minute, on top of the per-mobile OTP throttle and
 * the OTP and PIN attempt counters. Every other route has the global per-IP limit.
 */
export const AUTH_RATE_LIMITS = {
  otpRequest: 20,
  otpVerify: 30,
  pinVerify: 30,
  pinSet: 10,
  sessionRefresh: 60,
} as const satisfies Partial<Record<RouteName, number>>;

export const authRateLimit = (route: keyof typeof AUTH_RATE_LIMITS) => ({
  rateLimit: { max: AUTH_RATE_LIMITS[route], timeWindow: '1 minute' },
});
