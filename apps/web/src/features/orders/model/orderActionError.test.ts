import { ApiError } from '@nthstock/apiClient';
import type { ApiErrorCode } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { describeOrderActionError } from './orderActionError';

const http = (status: number, code: ApiErrorCode, message = '') =>
  new ApiError({ kind: 'http', status, code, message });

describe('describeOrderActionError (T-145)', () => {
  it('shows the engine reason for a 409 and feature copy otherwise', () => {
    expect(
      describeOrderActionError(
        http(
          409,
          'INVALID_ORDER_STATE',
          'This order is already executed, so it can’t be cancelled.',
        ),
      ),
    ).toBe('This order is already executed, so it can’t be cancelled.');
    expect(describeOrderActionError(http(404, 'NOT_FOUND'))).toBe('This order was not found.');
    expect(describeOrderActionError(http(401, 'UNAUTHORIZED'))).toBe(
      'Your session has ended. Log in again.',
    );
    expect(describeOrderActionError(http(500, 'INTERNAL_ERROR'))).toBe(
      'Something went wrong. Try again.',
    );
    expect(
      describeOrderActionError(
        new ApiError({ kind: 'network', status: 0, code: 'SERVICE_UNAVAILABLE', message: '' }),
      ),
    ).toMatch(/connection/);
    expect(describeOrderActionError(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});
