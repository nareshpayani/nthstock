import { ApiError } from '@nthstock/apiClient';
import { WATCHLIST_MESSAGES, type ApiErrorCode } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { watchlistErrorToast } from './watchlistError';

const http = (status: number, code: ApiErrorCode) =>
  new ApiError({ kind: 'http', status, code, message: 'server text' });

describe('watchlistErrorToast', () => {
  it('names the stock and the limit for a failed add', () => {
    expect(watchlistErrorToast('add', http(409, 'LIMIT_REACHED'), 'INFY')).toEqual({
      title: "Couldn't add INFY",
      description: WATCHLIST_MESSAGES.itemLimit,
    });
    expect(watchlistErrorToast('add', http(409, 'CONFLICT'), 'INFY').description).toBe(
      'INFY is already in this watchlist.',
    );
  });

  it.each([
    ['create', 'LIMIT_REACHED', WATCHLIST_MESSAGES.listLimit],
    ['create', 'CONFLICT', WATCHLIST_MESSAGES.duplicateName],
    ['rename', 'CONFLICT', WATCHLIST_MESSAGES.duplicateName],
    ['delete', 'CONFLICT', WATCHLIST_MESSAGES.lastList],
    ['reorder', 'CONFLICT', WATCHLIST_MESSAGES.staleOrder],
    ['rename', 'NOT_FOUND', WATCHLIST_MESSAGES.notFound],
    ['remove', 'UNAUTHORIZED', 'Log in again to change your watchlists.'],
    ['remove', 'INTERNAL_ERROR', 'Something went wrong. Please try again.'],
  ] as const)('%s + %s', (action, code, description) => {
    expect(watchlistErrorToast(action, http(409, code)).description).toBe(description);
  });

  it('has copy for network failures and unknown errors', () => {
    const offline = new ApiError({
      kind: 'network',
      status: 0,
      code: 'INTERNAL_ERROR',
      message: 'x',
    });
    expect(watchlistErrorToast('remove', offline)).toEqual({
      title: "Couldn't remove the stock",
      description: 'Check your internet connection and try again.',
    });
    expect(watchlistErrorToast('create', new Error('boom')).description).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
