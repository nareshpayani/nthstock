import { isApiError } from '@nthstock/apiClient';
import { AuthErrorDetails, type ApiErrorCode } from '@nthstock/contracts';

export type AuthFailure = {
  /** `NETWORK` when no response came back at all. */
  code: ApiErrorCode | 'NETWORK';
  details: AuthErrorDetails;
};

/** The code and the auth `details` (attempts left, CAPTCHA, retry-after) of a failed auth call. */
export function authFailure(error: unknown): AuthFailure {
  if (!isApiError(error)) return { code: 'INTERNAL_ERROR', details: {} };
  if (error.kind === 'network') return { code: 'NETWORK', details: {} };
  const details = AuthErrorDetails.safeParse(error.details ?? {});
  return { code: error.code, details: details.success ? details.data : {} };
}
