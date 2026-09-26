import { ApiError as ApiErrorBody, type ApiErrorCode } from '@nthstock/contracts';

/**
 * Where a failure came from:
 * - `http`: the server answered with a non-2xx status (and usually the ApiError envelope);
 * - `network`: no response at all (offline, DNS, CORS, server down);
 * - `contract`: a 2xx response whose body does not match the route's response schema.
 */
export type ApiErrorKind = 'http' | 'network' | 'contract';

/** Code used when a non-2xx response carries no valid ApiError envelope. */
export function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    case 502:
    case 503:
    case 504:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * The one error type every API call rejects with (aborts aside). User-facing copy is chosen from
 * `code` in each feature's strings.ts; `message` is for logs.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly kind: ApiErrorKind;
  /** HTTP status; 0 for network failures. */
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown> | undefined;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  /** Builds an ApiError from a non-2xx status and its (possibly non-JSON) body. */
  static fromResponse(status: number, body: unknown, statusText = ''): ApiError {
    const parsed = ApiErrorBody.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiError({ kind: 'http', status, code, message, details });
    }
    return new ApiError({
      kind: 'http',
      status,
      code: codeForStatus(status),
      message: statusText || `Request failed with status ${String(status)}`,
    });
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
