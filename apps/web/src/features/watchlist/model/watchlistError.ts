import { isApiError } from '@nthstock/apiClient';
import { strings } from '../strings';

export type WatchlistAction = 'create' | 'rename' | 'delete' | 'reorder' | 'add' | 'remove';

export type ErrorToast = { title: string; description: string };

/**
 * The toast for a failed watchlist change (ADR 0005: mutation errors show as a toast, copy from
 * strings.ts by error code). `symbol` names the stock for add and remove.
 */
export function watchlistErrorToast(
  action: WatchlistAction,
  error: unknown,
  symbol = '',
): ErrorToast {
  const title = strings.errors.title[action](symbol);
  if (!isApiError(error)) return { title, description: strings.errors.generic };
  if (error.kind === 'network') return { title, description: strings.errors.network };
  const byCode: Partial<Record<string, string>> = {
    LIMIT_REACHED: action === 'create' ? strings.errors.listLimit : strings.errors.itemLimit,
    CONFLICT: {
      create: strings.errors.duplicateName,
      rename: strings.errors.duplicateName,
      delete: strings.errors.lastList,
      add: strings.errors.duplicateItem(symbol),
      reorder: strings.errors.staleOrder,
      remove: strings.errors.staleOrder,
    }[action],
    NOT_FOUND: action === 'add' ? strings.errors.stockOrListGone : strings.errors.listGone,
    VALIDATION_ERROR: strings.errors.invalid,
    UNAUTHORIZED: strings.errors.loggedOut,
  };
  return { title, description: byCode[error.code] ?? strings.errors.generic };
}
