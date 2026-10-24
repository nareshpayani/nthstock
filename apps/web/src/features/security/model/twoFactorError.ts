import { isApiError } from '@nthstock/apiClient';
import { strings } from '../strings';

/** Copy for a failed two-factor call. */
export function describeTwoFactorError(error: unknown): string {
  if (!isApiError(error)) return strings.errors.generic;
  if (error.kind === 'network') return strings.errors.network;
  if (error.code === 'TOTP_INVALID') return strings.errors.wrongCode;
  if (error.code === 'CONFLICT') return error.message;
  return strings.errors.generic;
}
