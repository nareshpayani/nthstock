import { isApiError } from '@nthstock/apiClient';
import { strings } from '../strings';

/**
 * Copy for a refused cancel (T-145). A 409 carries the paper engine's plain-language reason
 * ("This order is already executed, so it can't be cancelled."), shown as is.
 */
export function describeOrderActionError(error: unknown): string {
  if (!isApiError(error)) return strings.errors.generic;
  if (error.kind === 'network') return strings.errors.network;
  if (error.status === 409 && error.message) return error.message;
  switch (error.code) {
    case 'NOT_FOUND':
      return strings.errors.notFound;
    case 'UNAUTHORIZED':
      return strings.errors.sessionEnded;
    default:
      return strings.errors.generic;
  }
}
