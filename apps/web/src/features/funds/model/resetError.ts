import { isApiError } from '@nthstock/apiClient';
import { strings } from '../strings';

/** Copy for a failed reset (T-160): the connection, or a generic retry. */
export function describeResetError(error: unknown): string {
  if (isApiError(error) && error.kind === 'network') return strings.errors.network;
  return strings.errors.generic;
}
