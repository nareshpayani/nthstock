import type { ApiError, ApiErrorCode } from '@nthstock/contracts';

/**
 * Throw from a route handler (or anywhere below it) to answer with the ApiError envelope.
 * The /v1 error handler turns it into `{ error: { code, message, details } }` with `status`.
 */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 404 for a missing resource, e.g. `notFound('Symbol NOPE')` → "Symbol NOPE not found". */
export const notFound = (what: string): never => {
  throw new ApiHttpError(404, 'NOT_FOUND', `${what} not found`);
};

/** Builds the ApiError body. `details` is left out when there are none. */
export function apiErrorBody(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

const CODE_BY_STATUS: Readonly<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** The error code for a bare HTTP status (framework errors such as malformed JSON or 413). */
export function codeForStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS[status] ?? (status < 500 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
}
